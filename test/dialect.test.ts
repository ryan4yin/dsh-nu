import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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

test('hints map Nushell error families and stay silent without stderr', () => {
  assert.equal(hintFor(''), undefined)
  assert.match(hintFor('nu::parser::shell_outerr') ?? '', /stderr-redirect/)
  assert.match(hintFor('nu::parser::shell_err') ?? '', /stderr-file/)
  assert.match(hintFor('Error: nu::shell::column_not_found') ?? '', /column-not-found/)
  assert.match(hintFor('Error: nu::parser::unknown_flag') ?? '', /unknown-flag/)
  assert.match(hintFor('nu::shell::external_command') ?? '', /missing-external/)
  assert.match(hintFor('Permission denied') ?? '', /permission-denied/)
  assert.match(hintFor('unexpected failure', { exitCode: 1, stdout: '' }) ?? '', /silent-failure/)
  assert.equal(hintFor('unexpected failure', { exitCode: 0 }), undefined)
  assert.equal(new Set(HINT_IDS).size, HINT_IDS.length)
})

const nu = spawnSync('nu', ['--version'], { encoding: 'utf8' })
const nuAvailable = nu.status === 0

function runNu(command: string, cwd: string): { status: number | null; stderr: string } {
  const result = spawnSync('nu', ['--no-config-file', '-c', command], { encoding: 'utf8', cwd })
  return { status: result.status, stderr: result.stderr }
}

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
