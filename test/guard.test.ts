import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertNuOnly, compileAllowlist, findHandoff, splitStatements } from '../src/guard.ts'

function shellOf(command: string): string | undefined {
  return findHandoff(command)?.shell
}

test('refuses direct foreign shells, with or without a path or suffix', () => {
  for (const [command, shell] of [
    ['bash -c "echo hi"', 'bash'],
    ['/bin/bash -c "echo hi"', 'bash'],
    ['/usr/bin/sh script.sh', 'sh'],
    ['zsh -i', 'zsh'],
    ['pwsh -Command Get-ChildItem', 'pwsh'],
    ['powershell -Command "Get-ChildItem"', 'powershell'],
    ['cmd /c dir', 'cmd'],
    ['cmd.exe /c dir', 'cmd'],
    ['wsl echo hi', 'wsl'],
    ['^bash -c "echo hi"', 'bash'],
    ['FOO=1 bash -c "echo hi"', 'bash'],
  ] as const) {
    assert.equal(shellOf(command), shell, command)
  }
})

test('refuses a shell anywhere in a pipeline or after a semicolon', () => {
  assert.equal(shellOf('ls | bash -c "cat"'), 'bash')
  assert.equal(shellOf('print hi; bash -c "echo hi"'), 'bash')
  assert.equal(shellOf('print hi\nbash -c "echo hi"'), 'bash')
})

test('refuses launchers that would start a foreign shell', () => {
  for (const command of [
    'env -S "bash -c \"echo hi\""',
    'env FOO=1 bash -c "echo hi"',
    'xargs -0 zsh -c "echo hi"',
    'sudo bash -c "echo hi"',
    'timeout 5 sh -c "echo hi"',
    'nice -n 5 fish -c "echo hi"',
    'busybox sh -c "echo hi"',
  ]) {
    assert.notEqual(findHandoff(command), undefined, command)
  }
})

test('refuses a handoff nested in a block or a subexpression', () => {
  for (const command of [
    'do { bash -c "echo hi" }',
    'let x = (sh -c "echo hi")',
    'if true { zsh -c "echo hi" }',
    'for x in [1] { pwsh -Command Get-ChildItem }',
  ]) {
    assert.notEqual(findHandoff(command), undefined, command)
  }
  for (const command of [
    'command -v bash',
    'print "do { bash -c x }"',
    'let r = { bash: 1 }',
    '[1 2] | each { |sh| $sh }',
    'def bash [] { print hi }',
  ]) {
    assert.equal(findHandoff(command), undefined, command)
  }
})

test('allows quoted, commented, raw, and external lookalikes', () => {
  for (const command of [
    'print "bash -c echo hi"',
    "print 'bash -c echo hi'",
    "print r#'bash -c echo hi'#",
    '# bash -c echo hi',
    'nu -c "bash -c echo hi"',
    'bashful --help',
    'print bash',
    'print "env -S bash"',
  ]) {
    assert.equal(findHandoff(command), undefined, command)
  }
})

test('splitStatements keeps quoted semicolons and drops comments', () => {
  assert.deepEqual(splitStatements('ls; print hi'), ['ls', 'print hi'])
  assert.deepEqual(splitStatements('print "a; b"'), ['print "a; b"'])
  assert.deepEqual(splitStatements('# note\nls'), ['ls'])
})

test('allowlists exempt exact whole commands and are validated', () => {
  const allow = compileAllowlist(['^bash -c'])
  assert.doesNotThrow(() => assertNuOnly('bash -c "echo hi"', { allow }))
  assert.throws(() => assertNuOnly('sh -c "echo hi"', { allow }), /sh/)
  assert.throws(() => compileAllowlist('bash'), /array/)
  assert.throws(() => compileAllowlist(['(']), /regular expression/)
})

test('the refusal names the shell and the offending statement', () => {
  assert.throws(
    () => assertNuOnly('ls | zsh -c "echo hi"'),
    (error: Error) => error.message.includes('zsh') && error.message.includes('ls | zsh -c'),
  )
})
