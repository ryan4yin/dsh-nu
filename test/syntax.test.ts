import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertNushellSyntax, findSyntaxIssue, hintFor, HINT_IDS, RULE_IDS } from '../src/syntax.ts'

const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['echo hi 2>&1', 'stderr-redirect'],
  ['echo hi > out.txt 2> err.txt', 'stderr-file'],
  ['echo hi 2>/dev/null', 'stderr-as-word'],
  ['echo hi 2>$null', 'stderr-as-word'],
  ['echo hi 2>nul', 'stderr-as-word'],
  ['echo hi 2>> build.log', 'stderr-as-word'],
  ['echo hi &> out.txt', 'stderr-as-word'],
  ['echo hi 1> out.txt', 'stderr-as-word'],
  ['echo hi > out.txt', 'stdout-redirect'],
  ['ls >> build.log', 'stdout-redirect'],
  ['^node build.cjs > /dev/null', 'stdout-redirect'],
  ['echo $env:FOO', 'powershell-env'],
  ['$x = 1', 'bare-assignment'],
  ['foreach ($x in [1 2]) { print $x }', 'foreach-loop'],
  ['Get-ChildItem', 'powershell-cmdlet'],
  ['echo a && echo b', 'and-or'],
  ['echo $(echo hi)', 'command-substitution'],
  ['echo $?', 'exit-status'],
  ['ls -R', 'bash-flag'],
  ['mkdir -p out/nested', 'bash-flag'],
  ['[[name size]; [a 1]] | select name, size', 'comma-column'],
  ['@(1, 2) | length', 'array-literal'],
  ['export FOO=1', 'export-assignment'],
  ['FOO=1 print hi', 'prefix-assignment'],
  ['ls | each { $_.name }', 'current-item'],
  ['if (-not (path exists /tmp)) { print no }', 'powershell-not'],
  ['ls | select -First 2', 'deprecated-flags'],
  ['ls -ErrorAction SilentlyContinue', 'powershell-parameter'],
  ['ls | first -3', 'negative-count'],
  ['print 1 | %{ $in }', 'percent-sigil'],
  ['print hi | o> out.txt', 'pipe-redirect'],
  ['glob pattern="**/*.rs"', 'glob-named-arguments'],
]

const ALLOWED = [
  'ls --all --long',
  'ls -la',
  'head -n 2',
  'wc -l',
  'grep -r x',
  'open --raw notes.txt | lines | first 2',
  'do { nu --version } | complete',
  'print "2>&1"',
  "print 'ls -la && echo $?'",
  '$env.FOO = "1"; print $env.FOO',
  'let x = 1; print $x',
  'mut x = 0; $x = $x + 1; print $x',
  'for x in [1 2] { print $x }',
  '[[name size]; [a 1]] | select name size',
  'cmd o> out.txt',
  'cmd o>> out.txt',
  'cmd e> err.txt',
  'cmd e>> err.txt',
  'cmd o+e> all.txt',
  'cmd o+e>> all.txt',
  'cmd e>| ignore',
  'cmd o+e>| ignore',
  'let n = 3; if $n > 2 { print "big" }',
  'print (2 > 1)',
  '[[size]; [2mb]] | where size > 1.5mb | length',
  "print '1 > out.txt'",
  'print "1 > out.txt"',
  'print "2>/dev/null"',
  '(do { ^false } | complete).exit_code',
  'print "export FOO=1; TOKEN=abc cmd"',
  'print "ls | select -First 2"',
  'print "glob pattern=**/*.rs"',
  'print "print 1 | %{ $in }"',
  'print ($env.DSH_NU_MISSING? == null)',
  '[[size]; [2mb]] | where size > 1mb | length',
  '[[name]; [a]] | sort-by name | first 1',
  '# echo hi 2>&1 | select name, type',
  'print "a > b"',
  'print "2>$null &> out.txt"',
  'print "TOKEN=abc node build.cjs"',
  'print "export FOO=1"',
  'print "# && 2>&1 TOKEN=abc"',
  'print "foreach ($x in [1]) { $x }"',
  'print "Get-ChildItem -Force"',
  'print "if (-not (Test-Path x)) { 1 }"',
  'print "glob pattern=**/*.rs"',
  'print "@(1, 2) %{ $in }"',
  '$env.DSH_DEMO = "1"; print $env.DSH_DEMO',
  'print ($env.DSH_MISSING? == null)',
  'do -i { ^nu -c "exit 1" }; print "after"',
  'try { error make { msg: "x" } } catch { |e| print $e.msg }',
  'print (match 1 { 1 => "a", _ => "b" })',
  '[1 2 3] | each { |n| $n * 2 } | math sum',
  '[1 2 3] | reduce { |it, acc| $it + $acc }',
  '"a1" | str replace -r \'\\d\' "#"',
  'glob "**/*.rs" | length',
  '^git --version | str contains "git"',
  '[[size]; [2mb]] | where size > 1mb | length',
  '[[a]; [1] [2]] | get -o b | length',
  'mkdir a/b; "a/b" | path exists',
  'rm -r -f a',
  'ls --all | length',
  '[a b] | where $it =~ "a" | length',
  '[a b] | where { |l| $l =~ "a" } | length',
  '^ls -R .',
  '^mkdir -p out/nested',
]

test('every rule rejects its sample', () => {
  for (const [command, id] of REFUSED) assert.equal(findSyntaxIssue(command)?.id, id, command)
  assert.deepEqual([...new Set(REFUSED.map(([, id]) => id))].sort(), [...RULE_IDS].sort())
})

test('valid Nushell and quoted syntax are not refused', () => {
  for (const command of ALLOWED) assert.equal(findSyntaxIssue(command), undefined, command)
})

test('the allowlist exempts exact commands and refusal names the fix', () => {
  assert.doesNotThrow(() => assertNushellSyntax('echo hi 2>&1', { allow: [/^echo hi 2>&1$/] }))
  assert.throws(() => assertNushellSyntax('echo hi 2>&1'), (error: Error) => error.message.includes('stderr-redirect') && error.message.includes('o+e>'))
})

test('hints stay silent without a recognized Nushell error', () => {
  assert.equal(hintFor(''), undefined)
  assert.equal(hintFor('some unrelated failure'), undefined)
  assert.equal(new Set(HINT_IDS).size, HINT_IDS.length)
})

const nu = spawnSync('nu', ['--version'], { encoding: 'utf8' })
const nuAvailable = nu.status === 0

function runNu(command: string, cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('nu', ['--no-config-file', '-c', command], { encoding: 'utf8', cwd })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const SILENT_WRONG: ReadonlyArray<readonly [string, string]> = [
  ['print hi 2>/dev/null', 'stderr-as-word'],
  ['print hi 2>$null', 'stderr-as-word'],
  ['print hi 2>nul', 'stderr-as-word'],
  ['print hi 2>> build.log', 'stderr-as-word'],
  ['print hi &> out.txt', 'stderr-as-word'],
  ['print hi 1> out.txt', 'stderr-as-word'],
  ['print hi > out.txt', 'stdout-redirect'],
  ['print hi >> build.log', 'stdout-redirect'],
  ['print hi > /dev/null', 'stdout-redirect'],
]

test('shell redirections Nushell accepts but silently ignores are refused', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-silent-'))
  try {
    for (const [command, id] of SILENT_WRONG) {
      const result = runNu(command, cwd)
      assert.equal(result.status, 0, command + ' should be accepted by Nushell')
      assert.equal(result.stderr, '', command + ' should look successful to Nushell')
      assert.throws(() => assertNushellSyntax(command), new RegExp(id), command)
    }
    // The shell spelling is not a redirect in Nushell, so it writes no file.
    assert.deepEqual(readdirSync(cwd), [], 'Nushell wrote a file for a shell redirect')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

interface HintSample {
  id: string
  command: string
  setup?: (cwd: string) => void
  enabled?: () => boolean
  /** When set, the sample counts only if stderr contains this marker. */
  onlyIf?: string
}

const HINT_SAMPLES: readonly HintSample[] = [
  { id: 'stderr-redirect', command: 'print hi 2>&1' },
  { id: 'stderr-file', command: 'print hi 2> err.txt' },
  { id: 'path-not-found', command: 'ls /definitely/missing' },
  { id: 'glob-pattern', command: "ls 'definitely-missing/**/*.md'" },
  { id: 'incompatible-path-access', command: "'abc' | str contains 'a' or 'b'" },
  { id: 'eval-block-with-input', command: 'ls | each { |f| open --raw $f.name }', setup: (cwd) => {
    writeFileSync(join(cwd, 'a.txt'), 'a')
    mkdirSync(join(cwd, 'sub'))
  } },
  { id: 'redirection-nothing', command: 'print 1 out+err>' },
  { id: 'percent-sigil', command: 'print 1 | %' },
  { id: 'column-not-found', command: '[[a]; [1]] | get b' },
  { id: 'find-builtin', command: 'find . -name "*.rs"' },
  { id: 'unknown-flag', command: 'ls --definitely-not-a-flag' },
  { id: 'deprecated-flag', command: 'ls | select -First 2' },
  { id: 'name-not-found', command: 'ls | select name, type', setup: (cwd) => {
    writeFileSync(join(cwd, 'a.txt'), 'a')
    writeFileSync(join(cwd, 'b.txt'), 'b')
  } },
  { id: 'unknown-command', command: '@(1, 2) | length' },
  { id: 'extra-positional', command: 'glob "**/*.rs" "."' },
  { id: 'http-error', command: 'http get http://127.0.0.1:1' },
  { id: 'immutable-assignment', command: 'let x = 1; $x = 2' },
  { id: 'env-var-not-var', command: 'print $PATH' },
  { id: 'assignment-requires-variable', command: 'let r = { a = 1 }' },
  { id: 'condition-not-boolean', command: 'if [ -f probe.txt ] { print yes }' },
  { id: 'cannot-pass-list-to-external', command: '^git add [a b]' },
  { id: 'needs-positive-value', command: 'ls | first -3' },
  { id: 'unexpected-redirection', command: 'print 1 | out+err>' },
  { id: 'is-a-directory', command: 'open --raw .' },
  { id: 'operator-unsupported-type', command: '1 + [1 2]' },
  { id: 'type-mismatch', command: "'abc' | into int" },
  { id: 'missing-external', command: '^definitely-not-installed-xyz' },
  {
    id: 'permission-denied',
    command: 'open secret.txt',
    setup: (cwd) => writeFileSync(join(cwd, 'secret.txt'), 'x', { mode: 0o000 }),
    enabled: () => process.platform !== 'win32' && (process.getuid?.() ?? -1) !== 0,
  },
  // /sys is read-only on some Linux hosts (EROFS) and merely unwritable on
  // others (EACCES); assert the matching hint whenever the probe really
  // produced that failure, otherwise skip and say so.
  { id: 'read-only-filesystem', command: "'x' | save -f /sys/dsh-nu-probe", enabled: () => process.platform === 'linux', onlyIf: 'read-only_filesystem_or_storage_medium' },
  { id: 'empty-pipeline', command: 'str trim' },
  { id: 'exit-status', command: 'echo $?' },
  { id: 'parse-error', command: 'print (1' },
]

test('every hint is produced by a real failure of the tested Nushell', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-hints-'))
  const checked: string[] = []
  const skipped: string[] = []
  try {
    for (const sample of HINT_SAMPLES) {
      if (sample.enabled !== undefined && !sample.enabled()) continue
      sample.setup?.(cwd)
      const result = runNu(sample.command, cwd)
      assert.notEqual(result.status, 0, 'expected a failure from: ' + sample.command)
      if (sample.onlyIf !== undefined && !result.stderr.includes(sample.onlyIf)) {
        skipped.push(sample.id + ' (environment produced a different error)')
        continue
      }
      const hint = hintFor(result.stderr, { exitCode: result.status, stdout: result.stdout })
      assert.match(hint ?? '', new RegExp('^Nushell hint \\(' + sample.id + '\\)'), sample.command + ' :: ' + result.stderr.slice(0, 160))
      checked.push(sample.id)
    }
    const expected = HINT_SAMPLES
      .filter((sample) => (sample.enabled === undefined || sample.enabled()) && !skipped.some((entry) => entry.startsWith(sample.id + ' ')))
      .map((sample) => sample.id)
    assert.deepEqual(checked.sort(), [...expected].sort())
    if (skipped.length > 0) console.warn('skipped environment-specific hints: ' + skipped.join(', '))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a bash env prefix that Nushell silently ignores is refused', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-prefix-'))
  try {
    const result = runNu('FOO=1 print hi', cwd)
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim(), 'hi')
    assert.throws(() => assertNushellSyntax('FOO=1 print hi'), /prefix-assignment/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('refused syntax forms genuinely fail in the tested Nushell', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-syntax-'))
  try {
    // Nushell accepts a bash-style env prefix and both silent redirect
    // spellings; refusing that silent wrong behaviour is the point of those
    // rules, and their own test above pins the exit-0 behaviour.
    const silentlyWrong = new Set(['prefix-assignment', 'stderr-as-word', 'stdout-redirect'])
    for (const [command, id] of REFUSED) {
      if (silentlyWrong.has(id)) continue
      assert.notEqual(runNu(command, cwd).status, 0, command)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the preflight does not refuse commands the tested Nushell accepts', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-syntax-'))
  try {
    const runnable = [
      'print "2>&1"',
      "print 'ls -la && echo $?'",
      'let x = 1; print $x',
      'mut x = 0; $x = $x + 1; print $x',
      'for x in [1 2] { print $x }',
      '[[name size]; [a 1]] | select name size | to json',
      'print hi o> out.txt',
      'print hi o>> out.txt',
      'print hi e> err.txt',
      'print hi e>> err.txt',
      'print hi o+e> all.txt',
      'print hi o+e>> all.txt',
      'let n = 3; if $n > 2 { print "big" }',
      'print (2 > 1)',
      '[[size]; [2mb]] | where size > 1.5mb | length',
      "print '1 > out.txt'",
      '(do { ^false } | complete).exit_code',
      'print "a > b"',
      'print "2>$null &> out.txt"',
      'print "TOKEN=abc node build.cjs"',
      'print "export FOO=1"',
      '# echo hi 2>&1',
      '$env.DSH_DEMO = "1"; print $env.DSH_DEMO',
      'print ($env.DSH_MISSING? == null)',
      'do -i { ^nu -c "exit 1" }; print "after"',
      'try { error make { msg: "x" } } catch { |e| print $e.msg }',
      'print (match 1 { 1 => "a", _ => "b" })',
      '[1 2 3] | each { |n| $n * 2 } | math sum',
      '[1 2 3] | reduce { |it, acc| $it + $acc }',
      '"a1" | str replace -r \'\\d\' "#"',
      'glob "**/*.rs" | length',
      '^git --version | str contains "git"',
      '[[size]; [2mb]] | where size > 1mb | length',
      'mkdir a/b; "a/b" | path exists',
      'rm -r -f a',
      'ls --all | length',
      '[a b] | where $it =~ "a" | length',
      '[a b] | where { |l| $l =~ "a" } | length',
      '^ls -R .',
      '^mkdir -p out/nested; "out/nested" | path exists',
    ]
    for (const command of runnable) {
      const result = runNu(command, cwd)
      assert.equal(result.status, 0, command + ' :: ' + result.stderr)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
