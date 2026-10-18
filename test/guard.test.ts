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

test('refuses nested handoffs through paths, env prefixes, and launchers', () => {
  for (const command of [
    'do { /bin/sh -c "echo P" }',
    'do { env bash -c "echo L" }',
    'if true { env bash -c "echo X" }',
    'do { FOO=1 bash -c "echo X" }',
    'let x = (env bash -c "echo P")',
    'time bash -c "echo T"',
    'setsid bash -c "echo S"',
    'flock /tmp/x.lock bash -c "echo F"',
    'watch -n 1 bash -c "echo W"',
  ]) {
    assert.notEqual(findHandoff(command), undefined, command)
  }
})

test('a mid-word # is not a comment, so a handoff after it is still refused', () => {
  assert.equal(findHandoff('print a#b'), undefined)
  assert.equal(findHandoff('print a#b; bash -c "echo H"')?.shell, 'bash')
  assert.equal(findHandoff('print (1)#b; sh -c "echo H"')?.shell, 'sh')
})

test('valid multiline data, match arms, record keys, and rest params are not handoffs', () => {
  for (const command of [
    'print a#b',
    'let words = [\n  bash\n]\nprint ($words | length)',
    'let r = {\n  sh : 1\n}\nprint $r.sh',
    'let r = { sh : 1 }\nprint $r.sh',
    'let r = { bash: 1 }\nprint $r.bash',
    'match "bash" { bash => 1, _ => 2 }',
    'match "bash" {\n  bash => 1\n  _ => 2\n}',
    '[1] | each {\n  |sh|\n  $sh\n} | length',
    '[1] | each { |sh, ...rest| $sh } | length',
    'def sh [] { print custom }; sh',
    'alias sh = print; sh hi',
  ]) {
    assert.equal(findHandoff(command), undefined, command)
  }
})

test('refuses a handoff inside an interpolated string', () => {
  for (const command of [
    `print $"a(bash -c 'echo I')b"`,
    `print $'(sh -c "echo H")'`,
    `let x = $"(env bash -c 'echo X')"`,
    `print $"outer ($"inner (bash -c 'echo N')") end"`,
  ]) {
    assert.notEqual(findHandoff(command), undefined, command)
  }
  for (const command of [
    'print "literal (bash -c x)"',
    "print 'literal (sh -c x)'",
    'print $"total (1 + 2)"',
    String.raw`print $"literal \(1 + 2\)"`,
    'print $"(1 + 2)"',
  ]) {
    assert.equal(findHandoff(command), undefined, command)
  }
})

test('splitStatements ignores newlines inside brackets and semicolons inside quotes', () => {
  assert.deepEqual(splitStatements('let r = {\n  a: 1\n}\nprint $r'), ['let r = {\n  a: 1\n}', 'print $r'])
  assert.deepEqual(splitStatements('print [\n  1\n  2\n]'), ['print [\n  1\n  2\n]'])
  assert.deepEqual(splitStatements('let a = 1; let b = 2'), ['let a = 1', 'let b = 2'])
  assert.deepEqual(splitStatements('print a#b'), ['print a#b'])
  assert.deepEqual(splitStatements('print [1, # note\n2]'), ['print [1, \n2]'])
})

test('the allowlist exempts exact whole commands and are validated', () => {
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
