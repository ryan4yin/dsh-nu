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
import { assertNuOnly, compileAllowlist } from './guard.js'
import { assertNuDialect, hintFor } from './dialect.js'
import {
  chooseBinary,
  commandArgv,
  DEFAULT_NU_ARGS,
  dshVersionWarning,
  normalizePrefix,
  nuFacts,
  parseVersion,
  resolveDshVersion,
  TESTED_NUSHELL,
} from './nu.js'
import type { NuChoice } from './nu.js'

/** The platform's first-party sandbox executor whose mechanics this keeps. */
const BaseExecutor = (process.platform === 'win32' ? SandboxPwshExecutor : SandboxBashExecutor) as unknown as typeof SandboxBashExecutor

/** Nushell's own read-only dialect; the sandbox runner only knows the POSIX EROFS text. */
const NU_DENIAL_SIGNATURES = ['read-only_filesystem_or_storage_medium'] as const

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
  dialectLint?: boolean
  dialectHints?: boolean
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
 * | foreignShellAllowlist | [] | whole-command regexes exempt from both checks |
 * | dialectLint | true | refuse bash/PowerShell habits before spawning |
 * | dialectHints | true | append one hint to a failed command's stderr |
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
    dialectLint: z.boolean().default(true),
    dialectHints: z.boolean().default(true),
    requireNu: z.boolean().default(true),
    verifyNu: z.boolean().default(true),
    verifyTimeoutMs: z.number().default(10_000),
    foreignShellAllowlist: z.array(z.string()).default([]),
  }) as unknown as typeof BaseExecutor.Config

  /** Plain instance state: cordis proxies the service receiver, so no #private. */
  settings: NuSettings

  constructor(ctx: Context, config: NushellConfig = {}) {
    super(ctx, config as BaseConfig)
    const choice = chooseBinary(config.nuPath)
    this.settings = {
      choice,
      prefix: normalizePrefix(config.nuArgs),
      allow: compileAllowlist(config.foreignShellAllowlist),
      enforce: config.enforceNushellOnly !== false,
      lint: config.dialectLint !== false,
      hints: config.dialectHints !== false,
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
        const warning = dshVersionWarning(resolveDshVersion())
        if (warning !== undefined) this.note('warn', warning)
        return
      }
      settings.resolvedPath = await this.ctx.subprocess.resolveExecutable(settings.choice.binary)
      nuFacts.resolvedPath = settings.resolvedPath
      this.note('info', 'shell executor bound to Nushell at ' + settings.resolvedPath)
    } catch (error) {
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
    if (version === undefined && (stdout + stderr).trim().length === 0) throw new Error('nu --version printed nothing')
    return version
  }

  /** The exact argv for one command, after both preflight checks. */
  nuArgv(command: string): string[] {
    const settings = this.settings
    if (settings.enforce) assertNuOnly(command, { allow: settings.allow })
    if (settings.lint) assertNuDialect(command, { allow: settings.allow })
    return commandArgv(command, { binary: this.nuBinary, origin: settings.choice.origin }, settings.prefix)
  }

  /** The argv seam the base class calls from both execute branches. */
  argv(spec: ShellExecSpec): string[] {
    return this.nuArgv(spec.command)
  }

  /** The confinement seam, shared by the POSIX and Windows families. */
  // @ts-expect-error -- the parent declares this seam private; overriding it is the provider extension point.
  async confine(command: string, policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> {
    const prepared = await this.ctx.sandbox.confine(this.nuArgv(command), policy, signal)
    return {
      ...prepared,
      denialSignatures: [...new Set([...(prepared.denialSignatures ?? []), ...NU_DENIAL_SIGNATURES])],
    }
  }

  /** Wrap a handle so its foreground projection carries one hint on failure. */
  private attach(handle: ShellExecution, spec: ShellExecSpec, sandbox?: ShellSandboxInfo): ShellExecution {
    const base = handle.result.bind(handle)
    let decorated: Promise<ShellRunResult> | undefined
    handle.result = () => {
      decorated ??= base().then((result) => this.withHint(result, spec, sandbox))
      return decorated
    }
    return handle
  }

  /** Append one hint to a failed result's stderr. */
  private withHint(result: ShellRunResult, _spec: ShellExecSpec, sandbox?: ShellSandboxInfo): ShellRunResult {
    const projected = sandbox === undefined ? result : { ...result, sandbox }
    if (!this.settings.hints) return projected
    const text = projected.stderr?.text
    if (typeof text !== 'string' || text.length === 0) return projected
    const hint = hintFor(text, { exitCode: projected.exitCode, stdout: projected.stdout?.text })
    if (hint === undefined) return projected
    const separator = text.endsWith('\n') ? '' : '\n'
    return { ...projected, stderr: { ...projected.stderr, text: text + separator + hint + '\n' } }
  }

  /** The one execution entry point of the shell seam. */
  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    const policyService = (this.ctx as unknown as { sandboxPolicy: { resolve: () => SandboxExecutionPolicy } }).sandboxPolicy
    const policy: SandboxExecutionPolicy = spec.sandboxPolicy ?? policyService.resolve()
    if (policy.mode === 'danger-full-access') {
      const handle = await this.executeArgv(spec, this.nuArgv(spec.command))
      return this.attach(handle, spec, { mode: policy.mode, denied: false })
    }
    const delegated: ShellExecSpec = { ...spec, sandboxPolicy: policy }
    const handle = await super.execute(delegated)
    return this.attach(handle, spec)
  }
}

export default NushellExecutor
