/**
 * The Nushell shell executor: the one ctx.shell provider of a Nu-only deployment.
 *
 * dsh's sandbox executor owns the mechanics that must not drift: request
 * defaulting, deadlines, output caps and spill, background handles, sandbox
 * wrapping, and denial facts. This class changes one thing: the program a
 * command runs as. Instead of a bash or PowerShell shell it spawns
 * `nu --no-config-file -c "<command>"`.
 *
 * The unconfined path runs the Nu argv through the inherited argv seam; the
 * confined path delegates to the parent and supplies the Nu argv through the
 * confinement seam, so the parent's mode/enforcement/denial reporting is kept.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox'
import type { ConfinedArgv, SandboxExecutionPolicy, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ShellExecSpec, ShellExecution, ShellRunResult, ShellSandboxInfo } from '@deepseek-ai/dsh-shell'
import z from '@deepseek-ai/schemastery'
import { PreflightError, analyze } from './ast.js'
import { assertNuOnly, compileAllowlist } from './guard.js'
import { assertNushellSyntax, deprecationHintFor, findSyntaxIssue, hintFor } from './syntax.js'
import {
  chooseBinary,
  commandArgv,
  DEFAULT_NU_ARGS,
  dshVersionWarning,
  normalizePrefix,
  nuFacts,
  parseVersion,
  resolveDshVersion,
  TESTED_DSH,
  TESTED_NUSHELL,
} from './nu.js'
import type { NuChoice } from './nu.js'

/** The platform's first-party sandbox executor whose mechanics this keeps. */
const BaseExecutor = (process.platform === 'win32' ? SandboxPwshExecutor : SandboxBashExecutor) as unknown as typeof SandboxBashExecutor

/**
 * The parent methods this provider overrides or calls. They are not public
 * dsh API: if a release renamed one, the parent would quietly run its own shell
 * instead of Nushell, so construction fails instead.
 */
const BASE_SEAMS: readonly string[] = process.platform === 'win32' ? ['executeArgv', 'confine', 'argv'] : ['executeArgv', 'confine']

/** Throw when the base executor no longer has a seam this provider relies on. */
export function assertBaseSeams(prototype: object, seams: readonly string[] = BASE_SEAMS): void {
  const missing = seams.filter((seam) => typeof (prototype as Record<string, unknown>)[seam] !== 'function')
  if (missing.length === 0) return
  throw new Error(
    'dsh-nu: the installed dsh shell executor no longer has ' + missing.join(', ')
    + ', which the Nushell executor overrides; refusing to start rather than run commands in its built-in shell. '
    + 'Install the tested dsh ' + (TESTED_DSH ?? 'version') + '.',
  )
}

/** Nushell's own read-only denial signature; the sandbox runner only knows the POSIX EROFS text. */
const NU_DENIAL_SIGNATURES = ['read-only_filesystem_or_storage_medium'] as const

/**
 * A boot failure of the parser canary. It carries its own actionable message,
 * so `Service.init` rethrows it instead of wrapping it as "install Nushell".
 */
export class AstProbeError extends Error {
  override name = 'AstProbeError'
}

/** The plugin name used in loader diagnostics. */
export const name = 'nu-executor'

/** Service dependencies, restated from the resolved base executor. */
export const inject: string[] = [...BaseExecutor.inject]

/** The base executor's config type. */
type BaseConfig = ConstructorParameters<typeof BaseExecutor>[1]

/** The plugin config: inherited sandbox budgets plus the Nu-only keys. */
export interface NushellConfig {
  cwd?: Volatile<string | undefined>
  timeoutMs?: Volatile<number>
  maxTimeoutMs?: Volatile<number>
  maxOutputBytes?: Volatile<number>
  maxSpillBytes?: Volatile<number>
  graceMs?: Volatile<number>
  nuPath?: string
  nuArgs?: string[]
  enforceNushellOnly?: boolean
  syntaxLint?: boolean
  syntaxHints?: boolean
  requireNu?: boolean
  verifyNu?: boolean
  verifyTimeoutMs?: number
  foreignShellAllowlist?: string[]
}

/** Resolved Nu settings, computed once in the constructor. */
interface NuSettings {
  choice: NuChoice
  prefix: string[]
  allow: RegExp[]
  enforce: boolean
  lint: boolean
  hints: boolean
  require: boolean
  verify: boolean
  verifyTimeoutMs: number
  resolvedPath: string | undefined
}

/**
 * The Nushell-backed shell provider.
 *
 * | config | default | meaning |
 * |---|---|---|
 * | nuPath | DSH_NU_PATH, then nu | executable |
 * | nuArgs | ['--no-config-file','-c'] | argv prefix; the command is appended |
 * | enforceNushellOnly | true | refuse commands that hand off to another shell |
 * | foreignShellAllowlist | [] | regexes exempt from both checks; each must match the whole command |
 * | syntaxLint | true | refuse bash/PowerShell syntax before spawning |
 * | syntaxHints | true | append one hint for a recognized failure or deprecation warning, including exit 0 |
 * | requireNu | true | fail boot when nu cannot be resolved |
 * | verifyNu | true | run nu --version once at boot |
 * | verifyTimeoutMs | 10000 | bound for that probe |
 */
// @ts-expect-error -- the parent declares its confinement seam private; overriding it is the provider extension point.
export class NushellExecutor extends BaseExecutor {
  static override inject: string[] = [...BaseExecutor.inject]

  static override Config = z.object({
    ...(BaseExecutor.Config.dict ?? {}),
    nuPath: z.string().default(''),
    nuArgs: z.array(z.string()).default([...DEFAULT_NU_ARGS]),
    enforceNushellOnly: z.boolean().default(true),
    syntaxLint: z.boolean().default(true),
    syntaxHints: z.boolean().default(true),
    requireNu: z.boolean().default(true),
    verifyNu: z.boolean().default(true),
    verifyTimeoutMs: z.number().default(10_000),
    foreignShellAllowlist: z.array(z.string()).default([]),
  }) as unknown as typeof BaseExecutor.Config

  /** Plain instance state: cordis proxies the service receiver, so no #private. */
  settings: NuSettings

  constructor(ctx: Context, config: NushellConfig = {}) {
    super(ctx, config as BaseConfig)
    assertBaseSeams(BaseExecutor.prototype)
    const choice = chooseBinary(config.nuPath)
    this.settings = {
      choice,
      prefix: normalizePrefix(config.nuArgs),
      allow: compileAllowlist(config.foreignShellAllowlist),
      enforce: config.enforceNushellOnly !== false,
      lint: config.syntaxLint !== false,
      hints: config.syntaxHints !== false,
      require: config.requireNu !== false,
      verify: config.verifyNu !== false,
      verifyTimeoutMs: typeof config.verifyTimeoutMs === 'number' && config.verifyTimeoutMs > 0 ? config.verifyTimeoutMs : 10_000,
      resolvedPath: undefined,
    }
    nuFacts.binary = choice.binary
    nuFacts.origin = choice.origin
  }

  /** Log one line, tolerating a composition without a logger. */
  private note(level: 'info' | 'warn', message: string): void {
    try {
      this.ctx.logger?.[level]('dsh-nu: ' + message)
    } catch {
      // Logging is best-effort.
    }
  }

  /** Resolve nu and prove it runs before the first tool call. */
  async [Service.init](): Promise<void> {
    const settings = this.settings
    try {
      if (settings.verify) {
        const version = await this.probeVersion(settings.choice.binary)
        settings.resolvedPath = this.probePath
        nuFacts.version = version
        if (version !== undefined && TESTED_NUSHELL !== undefined && version !== TESTED_NUSHELL) {
          this.note('warn', 'Nushell ' + version + ' differs from the tested ' + TESTED_NUSHELL + '; the guard, hints, and guide are tuned to the tested version')
        }
        this.note('info', version === undefined
          ? 'shell executor bound to Nushell at ' + settings.resolvedPath
          : 'shell executor bound to Nushell ' + version + ' (' + settings.resolvedPath + ')')
        if (settings.enforce || settings.lint) await this.probeAst()
        if ((settings.enforce || settings.lint) && !this.settings.prefix.includes('--no-config-file')) {
          // The probes always parse with --no-config-file; a config that defines
          // aliases or commands would run code the preflight never saw.
          this.note('warn', 'nuArgs omits --no-config-file, so Nushell may load a config whose aliases and commands the preflight does not see')
        }
        const warning = dshVersionWarning(resolveDshVersion())
        if (warning !== undefined) this.note('warn', warning)
        return
      }
      settings.resolvedPath = await this.ctx.subprocess.resolveExecutable(settings.choice.binary)
      nuFacts.resolvedPath = settings.resolvedPath
      this.note('info', 'shell executor bound to Nushell at ' + settings.resolvedPath)
    } catch (error) {
      // The AST probe already names the tested version and the escape hatches;
      // adding "install Nushell" advice would be wrong for a binary that ran.
      if (error instanceof AstProbeError) throw error
      const detail = error instanceof Error ? error.message : String(error)
      nuFacts.problem = detail
      if (settings.require) {
        throw new Error(
          'dsh-nu: cannot use the Nushell executable ' + JSON.stringify(settings.choice.binary) + ' (' + detail + '). '
          + 'Install Nushell and put nu on PATH, or set nuPath / DSH_NU_PATH; set requireNu: false to boot anyway.',
        )
      }
      this.note('warn', 'Nushell is unavailable (' + detail + '); shell calls will fail until it is installed')
    }
  }

  /**
   * Prove the two parser probes work before the first shell call, and that the
   * token and diagnostic contract the guard reads has not drifted.
   */
  private async probeAst(): Promise<void> {
    try {
      const tokens = await analyze('^true', { binary: this.nuBinary, cwd: this.probeCwd() })
      if (!tokens.tokens.some((token) => token.shape === 'shape_external' && token.content === 'true')) {
        throw new Error('the IDE token stream no longer reports a forced external command as shape_external')
      }
      const diagnostic = await findSyntaxIssue('echo hi 2>&1', { binary: this.nuBinary, cwd: this.probeCwd() })
      if (diagnostic?.id !== 'stderr-redirect') {
        throw new Error('the IDE diagnostics no longer map a 2>&1 shell operation to stderr-redirect')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (this.settings.require) {
        throw new AstProbeError(
          'dsh-nu: Nushell at ' + this.nuBinary + ' cannot run the AST preflight (' + detail + '). '
          + 'Install the tested Nushell version, or set enforceNushellOnly: false / syntaxLint: false to run without the only-Nushell check.',
        )
      }
      this.note('warn', 'the AST preflight is unavailable (' + detail + '); shell calls will fail until it is installed')
    }
  }

  /** Where the probe resolved the executable, for diagnostics. */
  private probePath = 'nu'

  /** The executable a command will spawn. */
  get nuBinary(): string {
    return this.settings.resolvedPath ?? this.settings.choice.binary
  }

  /** The probed Nushell version, when known. */
  get nuVersion(): string | undefined {
    return nuFacts.version
  }

  /** Whether the foreign-shell guard is active. */
  get guardActive(): boolean {
    return this.settings.enforce
  }

  /** The directory the boot probe spawns in. */
  private probeCwd(): string {
    return this.config.cwd.get() ?? process.cwd()
  }

  /** Run nu --version through the subprocess seam. */
  private async probeVersion(binary: string): Promise<string | undefined> {
    this.probePath = await this.ctx.subprocess.resolveExecutable(binary)
    nuFacts.resolvedPath = this.probePath
    const handle = this.ctx.subprocess.spawn({
      argv: [this.probePath, '--version'],
      cwd: this.probeCwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 1000,
      signal: AbortSignal.timeout(this.settings.verifyTimeoutMs),
    })
    await handle.done
    const stdout = handle.collected?.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected?.stderr?.readFrom(0).text ?? ''
    const version = parseVersion(stdout + stderr)
    if (version === undefined) {
      const output = (stdout + stderr).trim()
      throw new Error(output.length === 0
        ? 'nu --version printed nothing'
        : 'nu --version did not report a version: ' + output.slice(0, 200))
    }
    return version
  }

  /**
   * Run both preflight checks against one command. The AST probes are I/O, so
   * this is the one asynchronous step before the base executor sees a spec; the
   * argv builders below are pure.
   */
  async preflight(command: string, signal?: AbortSignal): Promise<void> {
    const settings = this.settings
    if (!settings.enforce && !settings.lint) return
    const shared = { allow: settings.allow, binary: this.nuBinary, cwd: this.probeCwd() }
    try {
      await untilAborted((async () => {
        if (settings.enforce) await assertNuOnly(command, shared)
        if (settings.lint) await assertNushellSyntax(command, shared)
      })(), signal)
    } catch (error) {
      if (error instanceof PreflightError) {
        throw new Error(
          'dsh-nu: the Nushell AST preflight could not run (' + error.message + '). '
          + 'Refusing the command instead of skipping the only-Nushell check: update Nushell to the tested version, '
          + 'or set enforceNushellOnly: false / syntaxLint: false to run without that check.',
        )
      }
      throw error
    }
  }

  /** The exact argv for one command; preflight runs before this is reached. */
  nuArgv(command: string): string[] {
    return commandArgv(command, { binary: this.nuBinary, origin: this.settings.choice.origin }, this.settings.prefix)
  }

  /** The argv seam the base class calls from both execute branches. */
  argv(spec: ShellExecSpec): string[] {
    return this.nuArgv(spec.command)
  }

  /** The confinement seam, shared by the POSIX and Windows families. */
  // @ts-expect-error -- the parent declares this seam private; overriding it is the provider extension point.
  async confine(commandOrSpec: string | ShellExecSpec, policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> {
    // POSIX parents pass the command string; the Windows parent passes the spec.
    const command = typeof commandOrSpec === 'string' ? commandOrSpec : commandOrSpec.command
    const prepared = await this.ctx.sandbox.confine(this.nuArgv(command), policy, signal)
    return {
      ...prepared,
      denialSignatures: [...new Set([...(prepared.denialSignatures ?? []), ...NU_DENIAL_SIGNATURES])],
    }
  }

  /** Wrap a handle so its foreground projection carries at most one hint. */
  private attach(handle: ShellExecution, sandbox?: ShellSandboxInfo): ShellExecution {
    const base = handle.result.bind(handle)
    let decorated: Promise<ShellRunResult> | undefined
    handle.result = () => {
      decorated ??= base().then((result) => this.withHint(result, sandbox))
      return decorated
    }
    return handle
  }

  /** Append one hint for a failure or a successful deprecation warning. */
  private withHint(result: ShellRunResult, sandbox?: ShellSandboxInfo): ShellRunResult {
    const projected = sandbox === undefined ? result : { ...result, sandbox }
    if (!this.settings.hints) return projected
    if (typeof projected.exitCode !== 'number' || projected.timedOut || projected.aborted) return projected
    // A sandbox denial already carries the host's own denial/escalation wording.
    if (projected.sandbox?.denied === true) return projected
    const text = projected.stderr?.text
    if (typeof text !== 'string' || text.length === 0) return projected
    // Successful commands may emit deprecation warnings, but ordinary stderr
    // that resembles an error must not gain a failure hint on exit 0.
    const hint = projected.exitCode === 0 ? deprecationHintFor(text) : hintFor(text)
    if (hint === undefined) return projected
    const separator = text.endsWith('\n') ? '' : '\n'
    return { ...projected, stderr: { ...projected.stderr, text: text + separator + hint + '\n' } }
  }

  /** The one execution entry point of the shell seam. */
  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    await this.preflight(spec.command, spec.signal)
    const policyService = (this.ctx as unknown as { sandboxPolicy: { resolve: () => SandboxExecutionPolicy } }).sandboxPolicy
    const policy: SandboxExecutionPolicy = spec.sandboxPolicy ?? policyService.resolve()
    if (policy.mode === 'danger-full-access') {
      const handle = await this.executeArgv(spec, this.nuArgv(spec.command))
      return this.attach(handle, { mode: policy.mode, denied: false })
    }
    const delegated: ShellExecSpec = { ...spec, sandboxPolicy: policy }
    const handle = await super.execute(delegated)
    return this.attach(handle)
  }
}

/**
 * Settle with `work`, or reject with the signal's reason once it aborts. The
 * probes behind `work` are cached and shared, so they keep running for other callers.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export default NushellExecutor
