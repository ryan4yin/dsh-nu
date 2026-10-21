import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findSyntaxIssue, hintFor } from '../src/syntax.ts'
import { shellEvidence } from '../eval/evidence.ts'

interface RecoveryCase {
  id: string
  fixtures: Record<string, string>
  expect: { firstCommand: string; recoveryMatches: string }
}

const cases = JSON.parse(readFileSync(new URL('../eval/cases.json', import.meta.url), 'utf8')) as RecoveryCase[]
const repairs: Record<string, { hint: string; command: string }> = {
  'hint-record-input': { hint: 'input-type', command: 'open record.json | transpose key value | where key == PROBE | get value | first' },
  'hint-builtin-complete': { hint: 'complete-internal', command: 'try { open --raw value.txt } catch { |err| $err.msg }' },
  'hint-for-pipeline': { hint: 'statement-in-pipeline', command: '[1 2] | each { |x| $x * 2 } | to json --raw' },
  'hint-internal-stderr': { hint: 'internal-stderr-pipe', command: 'do -i { open --raw value.txt }' },
  'hint-deprecated-get': { hint: 'deprecated-flag', command: '{a: 1} | get -o a' },
}

test('model recovery cases reproduce the intended real diagnostic and have a working repair', async (t) => {
  assert.deepEqual(cases.filter((item) => item.id.startsWith('hint-')).map((item) => item.id).sort(), Object.keys(repairs).sort())
  for (const item of cases.filter((entry) => entry.id.startsWith('hint-'))) {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-eval-case-'))
    t.after(() => rmSync(cwd, { recursive: true, force: true }))
    for (const [name, content] of Object.entries(item.fixtures)) writeFileSync(join(cwd, name), content)
    const run = (command: string) => spawnSync('nu', ['--no-config-file', '-c', command], { cwd, encoding: 'utf8', timeout: 5_000 })
    const before = run(item.expect.firstCommand)
    assert.ifError(before.error)
    assert.equal(before.status, item.id === 'hint-deprecated-get' ? 0 : 1, item.id)
    const repair = repairs[item.id]!
    assert.match(hintFor(before.stderr) ?? '', new RegExp(`^Nushell hint \\(${repair.hint}\\):`), before.stderr)
    assert.equal(await findSyntaxIssue(item.expect.firstCommand, { cwd }), undefined, item.id)
    const after = run(repair.command)
    assert.ifError(after.error)
    assert.equal(after.status, 0, after.stderr)
    assert.equal(after.stderr, '')
    assert.match(after.stdout.trim(), new RegExp(item.expect.recoveryMatches), item.id)
    assert.equal(await findSyntaxIssue(repair.command, { cwd }), undefined, item.id)
    const calls = [
      { callId: 'initial', input: { command: item.expect.firstCommand } },
      { callId: 'repair', input: { command: repair.command } },
    ]
    const results = [
      { callId: 'initial', status: 'completed', result: before.stdout + before.stderr },
      { callId: 'repair', status: 'completed', result: after.stdout },
    ]
    assert.deepEqual(shellEvidence(item.expect, calls, results), {
      firstCommandMatched: true, recoveryMatched: true, outputMatched: true,
    })
    assert.equal(shellEvidence(item.expect, calls, results.slice(1)).firstCommandMatched, false)
    assert.equal(shellEvidence(item.expect, calls, results.slice(0, 1)).recoveryMatched, false)
    assert.equal(shellEvidence(item.expect, calls, [results[0]!, { ...results[1]!, status: 'error' }]).recoveryMatched, false)
    assert.equal(shellEvidence(item.expect, calls, [results[0]!, { ...results[1]!, result: before.stdout + before.stderr }]).recoveryMatched, false)
  }
})

test('the exit-status eval rejects real stderr piping that loses stdout and status', () => {
  const external = '^nu --no-config-file -c \'print visible; print -e hidden; exit 7\''
  const wrong = external + ' e>| ignore'
  const right = `(do { ${external} } | complete) | select stdout exit_code | to json --raw`
  const expectation = { outputJson: { stdout: 'visible\n', exit_code: 7 } }
  for (const [command, expected] of [[wrong, false], [right, true]] as const) {
    const actual = spawnSync('nu', ['--no-config-file', '-c', command], { encoding: 'utf8', timeout: 5_000 })
    assert.ifError(actual.error)
    assert.equal(actual.status, 0)
    if (!expected) {
      assert.equal(actual.stdout, '')
      assert.equal(actual.stderr.trim(), 'visible')
    }
    const evidence = shellEvidence(expectation,
      [{ callId: 'capture', input: { command } }],
      [{ callId: 'capture', status: 'completed', result: actual.stdout + (actual.stderr ? '\n[stderr]\n' + actual.stderr : '') }],
    )
    assert.equal(evidence.outputMatched, expected, actual.stdout + actual.stderr)
  }
})
