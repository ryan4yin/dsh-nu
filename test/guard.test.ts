import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertNuOnly, compileAllowlist, findHandoff } from '../src/guard.ts'

async function shellOf(command: string): Promise<string | undefined> {
  return (await findHandoff(command))?.shell
}

test('refuses direct foreign shells, with or without a path or suffix', async () => {
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
    assert.equal(await shellOf(command), shell, command)
  }
})

test('refuses a shell anywhere in a pipeline or after a semicolon or newline', async () => {
  assert.equal(await shellOf('ls | bash -c "cat"'), 'bash')
  assert.equal(await shellOf('print hi; bash -c "echo hi"'), 'bash')
  assert.equal(await shellOf('print hi\nbash -c "echo hi"'), 'bash')
})

test('refuses launchers that would start a foreign shell', async () => {
  for (const command of [
    'env -S "bash -c \\"echo hi\\""',
    "env -S'bash -c \"echo hi\"'",
    "env --split-string='bash -c \"echo hi\"'",
    'env FOO=1 bash -c "echo hi"',
    'xargs -0 zsh -c "echo hi"',
    'sudo bash -c "echo hi"',
    'timeout 5 sh -c "echo hi"',
    'nice -n 5 fish -c "echo hi"',
    'busybox sh -c "echo hi"',
    '^watch -n 1 bash -c "echo W"',
    'exec bash -c "echo hi"',
    'taskset 0x3 bash -c "echo hi"',
    'taskset -c 0-3 bash -c "echo hi"',
    'taskset -c0-3 bash -c "echo hi"',
    'flock /tmp/x.lock sh -c "echo hi"',
    "script -c 'bash -c \"echo hi\"'",
    "script -q -c 'bash -c \"echo hi\"'",
    'script -c "echo hi"',
  ]) {
    assert.notEqual(await findHandoff(command), undefined, command)
  }
})

test('does not treat a launcher argument as the launched program', async () => {
  for (const command of [
    'env echo bash',
    'env FOO=1 echo bash',
    'timeout 5 echo bash',
    'timeout 5 grep -r sh /tmp',
    'command -v bash',
    'flock /tmp/x.lock echo -c hi',
  ]) {
    assert.equal(await findHandoff(command), undefined, command)
  }
})

test('refuses a handoff nested in a block or a subexpression', async () => {
  for (const command of [
    'do { bash -c "echo hi" }',
    'let x = (sh -c "echo hi")',
    'if true { zsh -c "echo hi" }',
    'for x in [1] { pwsh -Command Get-ChildItem }',
  ]) {
    assert.notEqual(await findHandoff(command), undefined, command)
  }
  for (const command of [
    'print "do { bash -c x }"',
    'let r = { bash: 1 }',
    '[1 2] | each { |sh| $sh }',
    'def bash [] { print hi }',
  ]) {
    assert.equal(await findHandoff(command), undefined, command)
  }
})

test('a block-scoped definition does not mask a real shell invocation', async () => {
  for (const command of [
    'do { def bash [] { print custom } }; bash -c "echo hi"',
    'if false { def bash [] { print custom } }; bash -c "echo hi"',
    'do { alias bash = print }; bash -c "echo hi"',
  ]) {
    assert.notEqual(await findHandoff(command), undefined, command)
  }
})

test('follows launchers through run-external, env -S, raw strings, and attached flags', async () => {
  for (const command of [
    'run-external env bash',
    'run-external timeout 5 bash -c "echo hi"',
    'env -S "-u FOO bash -c \'echo hi\'"',
    'env -S "-- bash -c \'echo hi\'"',
    'env -S "FOO=1 timeout 5 bash -c \'echo hi\'"',
    'env -S "timeout 5 env bash -c \'echo hi\'"',
    `env -S r#'bash -c "echo hi"'#`,
    `nu -c r#'bash -c "echo hi"'#`,
    `nu --commands='bash -c "echo hi"'`,
    'flock --timeout 1 /tmp/x.lock bash -c "echo hi"',
    'flock -c \'bash -c "echo hi"\'',
    'sudo --user root bash -c "echo hi"',
  ]) {
    assert.notEqual(await findHandoff(command), undefined, command)
  }
})

test('refuses nix, su, sudo shell flags, and process launchers that start a foreign shell', async () => {
  for (const [command, shell] of [
    ['nix shell nixpkgs#hello -c bash -c "echo x"', 'bash'],
    ['nix shell nixpkgs#hello --command zsh', 'zsh'],
    ['nix develop -c bash -c "echo x"', 'bash'],
    ["nix --extra-experimental-features 'nix-command flakes' develop --command sh -c x", 'sh'],
    ['nix develop', 'bash'],
    ['nix shell nixpkgs#hello', 'sh'],
    ['nix run nixpkgs#bash -- -c x', 'bash'],
    ['nix run nixpkgs#bashInteractive', 'bash'],
    ['nix run nixpkgs#legacyPackages.x86_64-linux.zsh', 'zsh'],
    ['nix run nixpkgs#nushell -- -c "bash -c x"', 'bash'],
    ['nix-shell -p hello --run hello', 'bash'],
    ['nix-shell', 'bash'],
    ['su -c "echo x"', 'sh'],
    ['su - root', 'sh'],
    ['su -s /bin/zsh root', 'zsh'],
    ["su -s /usr/bin/nu -c 'bash -c x'", 'bash'],
    ['runuser -u nobody -- bash -c x', 'bash'],
    ['runuser nobody -c "echo x"', 'sh'],
    ['sudo -s', 'sh'],
    ['sudo -i ls', 'sh'],
    ['sudo -u root --login whoami', 'sh'],
    ['doas -s', 'sh'],
    ['ionice -c 3 bash -c x', 'bash'],
    ['chroot / bash', 'bash'],
    ['chroot --userspec 1:1 /srv/root', 'sh'],
    ['unbuffer bash -c x', 'bash'],
    ['strace -f -o /tmp/trace bash -c x', 'bash'],
    ['systemd-run --user --unit probe bash -c x', 'bash'],
    ['timeout $env.LIMIT bash -c x', 'bash'],
    ['nu -e "bash -c x"', 'bash'],
    ["nu --execute 'zsh -c x'", 'zsh'],
    ['xonsh -c x', 'xonsh'],
    ['elvish -c x', 'elvish'],
    ['yash -c x', 'yash'],
    ['osh -c x', 'osh'],
  ] as const) {
    assert.equal(await shellOf(command), shell, command)
  }
})

test('a refusal for a script file names direct execution', async () => {
  for (const [command, direct] of [
    ['bash scripts/build.sh', './scripts/build.sh'],
    ['bash build.sh --release', './build.sh'],
    ['/bin/sh tools/x.sh', './tools/x.sh'],
    ['nix develop -c bash tools/x.sh', './tools/x.sh'],
    ['pwsh -File build.ps1', './build.ps1'],
  ] as const) {
    await assert.rejects(assertNuOnly(command), (error: Error) => {
      assert.match(error.message, /run the file directly: /, command)
      assert.ok(error.message.includes(direct), command + ' names ' + direct)
      return true
    })
  }
})

test('a refusal for a shell running inline text carries no script advice', async () => {
  for (const command of ['bash -c "echo hi"', 'zsh -i', 'sudo -s ls', 'bash --version']) {
    await assert.rejects(assertNuOnly(command), (error: Error) => {
      assert.doesNotMatch(error.message, /run the file directly/, command)
      return true
    })
  }
})

test('nix, sudo, and process launchers running a non-shell program are not handoffs', async () => {
  for (const command of [
    'nix shell nixpkgs#hello -c hello',
    'nix develop -c npm test',
    'nix develop --help',
    'nix run nixpkgs#hello',
    'nix run .',
    'nix build .#checks.x86_64-linux.package',
    'nix flake check',
    'nix-shell --version',
    'sudo -u root ls -s',
    'ionice -c 3 ls',
    'chroot / ls',
    'strace -f ls',
    'systemd-run --user ls',
    'runuser -u nobody -- ls',
    'nu -e "print hi"',
    'su-tool --help',
  ]) {
    assert.equal(await findHandoff(command), undefined, command)
  }
})

test('a dynamic run-external program is out of reach, not a later argument', async () => {
  assert.equal(await findHandoff('let prog = "echo"; run-external $prog -- bash'), undefined)
})

test('allows quoted, commented, raw, and external lookalikes', async () => {
  for (const command of [
    'print "bash -c echo hi"',
    "print 'bash -c echo hi'",
    "print r#'bash -c echo hi'#",
    '# bash -c echo hi',
    'bashful --help',
    'print bash',
    'print "env -S bash"',
    "'bash -c \"echo hi\"' | save -f out",
  ]) {
    assert.equal(await findHandoff(command), undefined, command)
  }
})

test('refuses nested handoffs through paths, env prefixes, and launchers', async () => {
  for (const command of [
    'do { /bin/sh -c "echo P" }',
    'do { env bash -c "echo L" }',
    'if true { env bash -c "echo X" }',
    'do { FOO=1 bash -c "echo X" }',
    'let x = (env bash -c "echo P")',
    'time bash -c "echo T"',
    'setsid bash -c "echo S"',
    'flock /tmp/x.lock bash -c "echo F"',
  ]) {
    assert.notEqual(await findHandoff(command), undefined, command)
  }
})

test('a mid-word # is not a comment, so a handoff after it is still refused', async () => {
  assert.equal(await findHandoff('print a#b'), undefined)
  assert.equal((await findHandoff('print a#b; bash -c "echo H"'))?.shell, 'bash')
  assert.equal((await findHandoff('print (1)#b; sh -c "echo H"'))?.shell, 'sh')
})

test('valid multiline data, match arms, record keys, and rest params are not handoffs', async () => {
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
    assert.equal(await findHandoff(command), undefined, command)
  }
})

test('refuses a handoff inside an interpolated string', async () => {
  for (const command of [
    `print $"a(bash -c 'echo I')b"`,
    `print $'(sh -c "echo H")'`,
    `let x = $"(env bash -c 'echo X')"`,
    `print $"outer ($"inner (bash -c 'echo N')") end"`,
  ]) {
    assert.notEqual(await findHandoff(command), undefined, command)
  }
  for (const command of [
    'print "literal (bash -c x)"',
    "print 'literal (sh -c x)'",
    'print $"total (1 + 2)"',
    String.raw`print $"literal \(1 + 2\)"`,
    'print $"(1 + 2)"',
  ]) {
    assert.equal(await findHandoff(command), undefined, command)
  }
})

test('follows a literal nu -c script, but not a dynamic one', async () => {
  assert.equal(await shellOf('nu -c \'bash -c "echo hi"\''), 'bash')
  assert.equal(await shellOf('run-external bash -- -c "echo hi"'), 'bash')
  assert.equal(await shellOf('run-external nu -- -c \'bash -c "echo hi"\''), 'bash')
  assert.equal(await findHandoff('nu -c $script'), undefined)
})

test('a defined name parses as an internal call, not an external handoff', async () => {
  assert.equal(await findHandoff('def sh [] { print custom }; sh'), undefined)
  assert.equal(await shellOf('def sh [] { print custom }; /bin/sh -c "echo x"'), 'sh')
  assert.equal(await shellOf('def sh [] { print custom }; ^sh -c "echo x"'), 'sh')
})

test('the allowlist exempts exact whole commands and is validated', async () => {
  const allow = compileAllowlist(['bash -c "echo hi"'])
  await assert.doesNotReject(assertNuOnly('bash -c "echo hi"', { allow }))
  await assert.rejects(assertNuOnly('sh -c "echo hi"', { allow }), /sh/)
  assert.throws(() => compileAllowlist('bash'), /array/)
  assert.throws(() => compileAllowlist(['(']), /regular expression/)
})

test('an allowlist entry does not exempt a longer command that contains it', async () => {
  const allow = compileAllowlist(['bash scripts/ok.sh', '^bash -c'])
  await assert.doesNotReject(assertNuOnly('bash scripts/ok.sh', { allow }))
  for (const command of [
    'bash -c "echo EVIL"; # bash scripts/ok.sh',
    'bash scripts/ok.sh; bash -c "echo EVIL"',
    'bash -c "echo EVIL"',
  ]) {
    await assert.rejects(assertNuOnly(command, { allow }), /refusing to hand this command to bash/, command)
  }
  // A RegExp passed straight to the API is anchored the same way.
  await assert.rejects(assertNuOnly('bash -c "echo EVIL"', { allow: [/bash -c/] }), /bash/)
})

test('the refusal names the shell and the offending statement', async () => {
  await assert.rejects(
    assertNuOnly('ls | zsh -c "echo hi"'),
    (error: Error) => error.message.includes('zsh') && error.message.includes('ls | zsh'),
  )
})
