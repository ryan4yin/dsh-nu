import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertNuDialect } from '../src/dialect.ts'
import { assertNuOnly } from '../src/guard.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Commands a coding agent realistically writes, all valid in the pinned Nushell. */
const COMMANDS: ReadonlyArray<{ command: string; cwd?: 'temp' | 'repo' }> = [
  { command: 'ls | length', cwd: 'temp' },
  { command: 'open --raw README.md | lines | first 5', cwd: 'repo' },
  { command: 'open --raw README.md | str contains "dsh"', cwd: 'repo' },
  { command: 'glob *.ts | length', cwd: 'repo' },
  { command: 'let files = (glob *.ts); print ($files | length)', cwd: 'repo' },
  { command: '"hello" | str length', cwd: 'temp' },
  { command: '[[name size]; [a 1] [b 2]] | where size > 1 | get name', cwd: 'temp' },
  { command: '1..3 | each { |n| $n * 2 }', cwd: 'temp' },
  { command: 'print (1..3 | each { |n| $n * 2 } | math sum)', cwd: 'temp' },
  { command: '[1 2 3] | math sum', cwd: 'temp' },
  { command: '"a,b,c" | split row "," | length', cwd: 'temp' },
  { command: '"x1y2z" | str replace -r \'\\d\' "#"', cwd: 'temp' },
  { command: 'let x = 2; print ($x * 3)', cwd: 'temp' },
  { command: 'mut x = 1; $x = 2; print $x', cwd: 'temp' },
  { command: 'def double [n: int] { $n * 2 }; double 4', cwd: 'temp' },
  { command: 'match 2 { 1 => "one", _ => "other" }', cwd: 'temp' },
  { command: 'print $"sum=((1 + 1))"', cwd: 'temp' },
  { command: 'print ($env.PATH? | length)', cwd: 'temp' },
  { command: '$env.PWD | path exists', cwd: 'repo' },
  { command: '[[a]; [1]] | to json', cwd: 'temp' },
  { command: '1 | into string', cwd: 'temp' },
  { command: 'mkdir d; "x" | save -f d/a.txt; open --raw d/a.txt | str trim', cwd: 'temp' },
  { command: 'mkdir d; "x" | save -f d/a.txt; cp d/a.txt d/b.txt; ls d | length', cwd: 'temp' },
  { command: 'mkdir d; "x" | save -f d/a.txt; open --raw d/a.txt | lines | first 1', cwd: 'temp' },
  { command: 'do { ^git rev-parse --is-inside-work-tree } | complete | get exit_code', cwd: 'repo' },
  { command: 'do -i { ^false } | complete | get exit_code', cwd: 'repo' },
  { command: '^git status --short | lines | length', cwd: 'repo' },
  { command: 'git status --short | length', cwd: 'repo' },
  { command: '^git log --oneline -1', cwd: 'repo' },
  { command: 'print (ls | where type == file | length)', cwd: 'temp' },
]

function runNu(command: string, cwd: string): { status: number | null; stderr: string; error: string | undefined } {
  const result = spawnSync('nu', ['--no-config-file', '-c', command], { cwd, encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr, error: result.error === undefined ? undefined : String(result.error) }
}

test('the friction corpus passes the preflight and runs in the real Nushell', (t) => {
  const probe = runNu('print ok', process.cwd())
  if (probe.error !== undefined) {
    t.skip('nu is not installed: ' + probe.error)
    return
  }
  const work = mkdtempSync(join(tmpdir(), 'dsh-nu-friction-'))
  try {
    for (const entry of COMMANDS) {
      const cwd = entry.cwd === 'repo' ? ROOT : work
      assert.doesNotThrow(() => assertNuOnly(entry.command), 'guard refused: ' + entry.command)
      assert.doesNotThrow(() => assertNuDialect(entry.command), 'preflight refused: ' + entry.command)
      const result = runNu(entry.command, cwd)
      assert.equal(result.status, 0, entry.command + ' failed: ' + result.stderr.slice(0, 300))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('quoted shell syntax is data and is not refused', () => {
  for (const command of ['print "bash -c echo hi"', "print 'echo $env:HOME > out 2>&1'", 'print "a && b"', '# bash -c echo hi']) {
    assert.doesNotThrow(() => assertNuOnly(command), command)
    assert.doesNotThrow(() => assertNuDialect(command), command)
  }
})

test('an allowlist entry exempts the exact command from both checks', () => {
  assert.throws(() => assertNuOnly('bash -c "echo hi"'), /refusing to hand this command to bash/)
  assert.doesNotThrow(() => assertNuOnly('bash -c "echo hi"', { allow: [/^bash -c/] }))
  assert.throws(() => assertNuDialect('print hi 2>&1'), /stderr-redirect/)
  assert.doesNotThrow(() => assertNuDialect('print hi 2>&1', { allow: [/2>&1/] }))
})
