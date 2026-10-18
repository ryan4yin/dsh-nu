import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertNuDialect, findHabit, hintFor, HINT_IDS, RULE_IDS } from '../src/dialect.ts'

const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['echo hi 2>&1', 'stderr-redirect'],
  ['echo hi > out.txt 2> err.txt', 'stderr-file'],
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
  'cmd e> err.txt',
  'cmd o+e> all.txt',
  '(do { ^false } | complete).exit_code',
]

test('every rule rejects its sample', () => {
  for (const [command, id] of REFUSED) assert.equal(findHabit(command)?.id, id, command)
  assert.deepEqual([...new Set(REFUSED.map(([, id]) => id))].sort(), [...RULE_IDS].sort())
})

test('valid Nushell and quoted habits are not refused', () => {
  for (const command of ALLOWED) assert.equal(findHabit(command), undefined, command)
})

test('the allowlist exempts exact commands and refusal names the fix', () => {
  assert.doesNotThrow(() => assertNuDialect('echo hi 2>&1', { allow: [/^echo hi 2>&1$/] }))
  assert.throws(() => assertNuDialect('echo hi 2>&1'), (error: Error) => error.message.includes('stderr-redirect') && error.message.includes('o+e>'))
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

interface HintSample {
  id: string
  command: string
  setup?: (cwd: string) => void
  enabled?: () => boolean
}

const HINT_SAMPLES: readonly HintSample[] = [
  { id: 'stderr-redirect', command: 'print hi 2>&1' },
  { id: 'stderr-file', command: 'print hi 2> err.txt' },
  { id: 'path-not-found', command: 'ls /definitely/missing' },
  { id: 'column-not-found', command: '[[a]; [1]] | get b' },
  { id: 'unknown-flag', command: 'ls --definitely-not-a-flag' },
  { id: 'type-mismatch', command: "'abc' | into int" },
  { id: 'missing-external', command: '^definitely-not-installed-xyz' },
  {
    id: 'permission-denied',
    command: 'open secret.txt',
    setup: (cwd) => writeFileSync(join(cwd, 'secret.txt'), 'x', { mode: 0o000 }),
    enabled: () => process.platform !== 'win32' && (process.getuid?.() ?? -1) !== 0,
  },
  { id: 'read-only-filesystem', command: "'x' | save -f /sys/dsh-nu-probe", enabled: () => process.platform === 'linux' },
  { id: 'empty-pipeline', command: 'str trim' },
  { id: 'exit-status', command: 'echo $?' },
  { id: 'parse-error', command: 'print (1' },
]

test('every hint is produced by a real failure of the tested Nushell', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-hints-'))
  const checked: string[] = []
  try {
    for (const sample of HINT_SAMPLES) {
      if (sample.enabled !== undefined && !sample.enabled()) continue
      sample.setup?.(cwd)
      const result = runNu(sample.command, cwd)
      assert.notEqual(result.status, 0, 'expected a failure from: ' + sample.command)
      const hint = hintFor(result.stderr, { exitCode: result.status, stdout: result.stdout })
      assert.match(hint ?? '', new RegExp('^Nushell hint \\(' + sample.id + '\\)'), sample.command + ' :: ' + result.stderr.slice(0, 160))
      checked.push(sample.id)
    }
    const expected = HINT_SAMPLES.filter((sample) => sample.enabled === undefined || sample.enabled()).map((sample) => sample.id)
    assert.deepEqual(checked.sort(), [...expected].sort())
    assert.deepEqual([...new Set(checked)].sort(), [...expected].sort())
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('refused habits genuinely fail in the tested Nushell', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-dialect-'))
  try {
    for (const [command] of REFUSED) assert.notEqual(runNu(command, cwd).status, 0, command)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the preflight does not refuse commands the tested Nushell accepts', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-dialect-'))
  try {
    const runnable = [
      'print "2>&1"',
      "print 'ls -la && echo $?'",
      'let x = 1; print $x',
      'mut x = 0; $x = $x + 1; print $x',
      'for x in [1 2] { print $x }',
      '[[name size]; [a 1]] | select name size | to json',
      'print hi o> out.txt',
      'print hi e> err.txt',
      'print hi o+e> all.txt',
      '(do { ^false } | complete).exit_code',
    ]
    for (const command of runnable) {
      const result = runNu(command, cwd)
      assert.equal(result.status, 0, command + ' :: ' + result.stderr)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
