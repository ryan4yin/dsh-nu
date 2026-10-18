import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Service } from '@deepseek-ai/cordis'
import { NushellExecutor } from '../src/executor.ts'
import { nuFacts, TESTED_NUSHELL } from '../src/nu.ts'

function fakeContext() {
  const provided: string[] = []
  return {
    provided,
    reflect: {
      provide(name: string): void {
        provided.push(name)
      },
    },
    sandboxPolicy: { defaultMode: 'workspace-write', resolve: () => ({ mode: 'workspace-write', workspaceRoot: process.cwd() }) },
    logger: { info(): void {}, warn(): void {} },
    subprocess: { resolveExecutable: async (binary: string) => binary, spawn: () => { throw new Error('spawn is not used in these tests') } },
    sandbox: { confine: async (argv: string[]) => ({ argv, enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) },
  }
}

/** Base live budgets, shaped like the schema output the loader would supply. */
function executorConfig(overrides: Record<string, unknown>) {
  const volatile = <T>(value: T) => ({ get: () => value })
  return {
    cwd: volatile(process.cwd()),
    timeoutMs: volatile(120_000),
    maxTimeoutMs: volatile(600_000),
    maxOutputBytes: volatile(64_000),
    maxSpillBytes: volatile(1_048_576),
    graceMs: volatile(1_000),
    pwshPath: volatile('pwsh'),
    ...overrides,
  }
}

test('nuArgv places the command last behind the configured prefix', () => {
  const executor = new NushellExecutor(fakeContext() as never, executorConfig({ nuPath: '/opt/nu/bin/nu' }) as never)
  assert.deepEqual(executor.nuArgv('ls | length'), ['/opt/nu/bin/nu', '--no-config-file', '-c', 'ls | length'])
  assert.deepEqual(
    new NushellExecutor(fakeContext() as never, executorConfig({ nuPath: 'nu', nuArgs: ['--no-config-file', '-c'] }) as never).nuArgv('print hi'),
    ['nu', '--no-config-file', '-c', 'print hi'],
  )
})

test('the guard and the dialect preflight run before a command becomes argv', () => {
  const executor = new NushellExecutor(fakeContext() as never, executorConfig({ nuPath: 'nu' }) as never)
  assert.throws(() => executor.nuArgv('bash -c "echo hi"'), /refusing to hand this command to bash/)
  assert.throws(() => executor.nuArgv('print hi 2>&1'), /stderr-redirect/)
  assert.deepEqual(
    new NushellExecutor(fakeContext() as never, executorConfig({ nuPath: 'nu', enforceNushellOnly: false, dialectLint: false }) as never).nuArgv('bash -c "echo hi"'),
    ['nu', '--no-config-file', '-c', 'bash -c "echo hi"'],
  )
})

test('the allowlist exempts an exact command from both checks', () => {
  const executor = new NushellExecutor(fakeContext() as never, executorConfig({ nuPath: 'nu', foreignShellAllowlist: ['^bash -c'] }) as never)
  assert.deepEqual(executor.nuArgv('bash -c "echo hi"'), ['nu', '--no-config-file', '-c', 'bash -c "echo hi"'])
})
function probeHandle(text: string) {
  return {
    done: Promise.resolve({ exitCode: 0, signal: null }),
    collected: {
      stdout: { readFrom: () => ({ text, lossy: false, nextOffset: text.length }) },
      stderr: { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) },
    },
  }
}

function bootContext(options: {
  resolve?: (binary: string) => Promise<string>
  spawn?: (spec: { argv: string[] }) => unknown
  warn?: (line: string) => void
} = {}) {
  const context = fakeContext() as unknown as Record<string, unknown>
  context.subprocess = {
    resolveExecutable: options.resolve ?? (async (binary: string) => binary),
    spawn: options.spawn ?? (() => { throw new Error('spawn was not expected') }),
  }
  context.logger = { info(): void {}, warn: options.warn ?? ((): void => {}) }
  return context
}

test('boot probes nu --version and records the resolved executable', async () => {
  const spawns: Array<{ argv: string[] }> = []
  const context = bootContext({
    resolve: async () => '/opt/nu/bin/nu',
    spawn: (spec) => { spawns.push(spec); return probeHandle('nu ' + TESTED_NUSHELL) },
  })
  const executor = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu' }) as never)
  nuFacts.version = undefined
  await (executor as unknown as Record<symbol, () => Promise<void>>)[Service.init]!()
  assert.equal(executor.nuBinary, '/opt/nu/bin/nu')
  assert.equal(executor.nuVersion, TESTED_NUSHELL)
  assert.deepEqual(spawns[0]!.argv, ['/opt/nu/bin/nu', '--version'])
})

test('boot warns when the probed Nushell is not the tested version', async () => {
  const warnings: string[] = []
  const context = bootContext({ spawn: () => probeHandle('nu 0.114.0'), warn: (line) => warnings.push(line) })
  const executor = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu' }) as never)
  await (executor as unknown as Record<symbol, () => Promise<void>>)[Service.init]!()
  assert.ok(warnings.some((line) => line.includes('0.114.0') && line.includes(TESTED_NUSHELL!)))
})

test('boot fails closed when requireNu is set and resolution fails', async () => {
  const context = bootContext({ resolve: async () => { throw new Error('not found') } })
  const strict = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu' }) as never)
  await assert.rejects((strict as unknown as Record<symbol, () => Promise<void>>)[Service.init]!(), /requireNu|not found/)
  const lenient = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu', requireNu: false }) as never)
  await (lenient as unknown as Record<symbol, () => Promise<void>>)[Service.init]!()
})

test('verifyNu false skips the version probe', async () => {
  const spawns: Array<{ argv: string[] }> = []
  const context = bootContext({ spawn: (spec) => { spawns.push(spec); return probeHandle('nu 0.115.1') } })
  const executor = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu', verifyNu: false }) as never)
  await (executor as unknown as Record<symbol, () => Promise<void>>)[Service.init]!()
  assert.equal(spawns.length, 0)
})

test('the confinement seam wraps the Nu argv', async () => {
  const confined: string[][] = []
  const context = fakeContext() as unknown as Record<string, unknown>
  context.sandbox = { confine: async (argv: string[]) => { confined.push(argv); return { argv, enforcement: 'full', denialSignatures: [], runnerFailureRules: [] } } }
  const executor = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu' }) as never)
  const result = await (executor as unknown as { confine: (command: string, policy: never) => Promise<{ argv: string[] }> }).confine('print hi', { mode: 'workspace-write' } as never)
  assert.deepEqual(confined[0], ['nu', '--no-config-file', '-c', 'print hi'])
  assert.deepEqual(result.argv, ['nu', '--no-config-file', '-c', 'print hi'])
})

test('the confinement seam keeps the Nu read-only denial dialect', async () => {
  const context = fakeContext() as unknown as Record<string, unknown>
  context.sandbox = { confine: async (argv: string[]) => ({ argv, enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }) }
  const executor = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu' }) as never)
  const result = await (executor as unknown as {
    confine: (command: string, policy: never) => Promise<{ denialSignatures: string[] }>
  }).confine('print hi', { mode: 'workspace-write' } as never)
  assert.ok(result.denialSignatures.includes('read-only_filesystem_or_storage_medium'))
})

test('resolve keeps the caller workdir and the inherited budgets', () => {
  const executor = new NushellExecutor(fakeContext() as never, executorConfig({
    nuPath: 'nu',
    timeoutMs: { get: () => 5_000 },
    maxTimeoutMs: { get: () => 10_000 },
  }) as never)
  const spec = executor.resolve({ command: 'print hi', workdir: '/tmp' })
  assert.equal(spec.workdir, '/tmp')
  assert.ok(spec.timeoutMs > 0 && spec.timeoutMs <= 10_000)
})

test('execute spawns the Nu argv and appends one hint to a matching failure', async () => {
  const spawns: Array<{ argv: string[] }> = []
  const context = fakeContext() as unknown as Record<string, unknown>
  context.subprocess = {
    resolveExecutable: async (binary: string) => binary,
    spawn: (spec: { argv: string[] }) => {
      spawns.push(spec)
      return {
        done: Promise.resolve({ exitCode: 1, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) },
          stderr: { readFrom: () => ({ text: 'Error: nu::parser::unknown_flag\n  x unknown flag\n', lossy: false, nextOffset: 0 }) },
        },
      }
    },
  }
  const executor = new NushellExecutor(context as never, executorConfig({ nuPath: 'nu' }) as never)
  const spec = {
    command: 'ls --nope',
    workdir: process.cwd(),
    timeoutMs: 1_000,
    onExpiry: 'kill' as const,
    stdoutMaxBytes: 64_000,
    sandboxPolicy: { mode: 'danger-full-access' as const, workspaceRoot: process.cwd() },
  }
  const handle = await executor.execute(spec)
  const result = await handle.result()
  assert.deepEqual(spawns[0]!.argv, ['nu', '--no-config-file', '-c', 'ls --nope'])
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr.text, /Nushell hint \(unknown-flag\)/)
})
