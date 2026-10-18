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

test('nuArgv places the command last behind the configured prefix', () => {
  const executor = new NushellExecutor(fakeContext() as never, { nuPath: '/opt/nu/bin/nu' })
  assert.deepEqual(executor.nuArgv('ls | length'), ['/opt/nu/bin/nu', '--no-config-file', '-c', 'ls | length'])
  assert.deepEqual(
    new NushellExecutor(fakeContext() as never, { nuPath: 'nu', nuArgs: ['--no-config-file', '-c'] }).nuArgv('print hi'),
    ['nu', '--no-config-file', '-c', 'print hi'],
  )
})

test('the guard and the dialect preflight run before a command becomes argv', () => {
  const executor = new NushellExecutor(fakeContext() as never, { nuPath: 'nu' })
  assert.throws(() => executor.nuArgv('bash -c "echo hi"'), /refusing to hand this command to bash/)
  assert.throws(() => executor.nuArgv('print hi 2>&1'), /stderr-redirect/)
  assert.deepEqual(
    new NushellExecutor(fakeContext() as never, { nuPath: 'nu', enforceNushellOnly: false, dialectLint: false }).nuArgv('bash -c "echo hi"'),
    ['nu', '--no-config-file', '-c', 'bash -c "echo hi"'],
  )
})

test('the allowlist exempts an exact command from both checks', () => {
  const executor = new NushellExecutor(fakeContext() as never, {
    nuPath: 'nu',
    foreignShellAllowlist: ['^bash -c'],
  })
  assert.deepEqual(executor.nuArgv('bash -c "echo hi"'), ['nu', '--no-config-file', '-c', 'bash -c "echo hi"'])
})
