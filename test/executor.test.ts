import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NushellExecutor } from '../src/executor.ts'

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
