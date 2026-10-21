import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'

const scanner = fileURLToPath(new URL('../dev/session-scan.mjs', import.meta.url))
const sentinel = 'SOURCE_PAYLOAD_MUST_NOT_APPEAR'
const lines = (events: unknown[]): string => events.map((event) => JSON.stringify(event)).join('\n') + '\n'
const call = (callId: string, tool = 'bash') => ({ type: 'tool_call', callId, tool, input: { command: sentinel } })
const result = (callId: string, text: string, status = 'completed') => ({ type: 'tool_result', callId, status, result: text })

function fixture(t: TestContext): string {
  const parent = realpathSync(tmpdir())
  const dir = mkdtempSync(join(parent, 'dsh-nu-session-scan-'))
  t.after(() => {
    assert.equal(dirname(realpathSync(dir)), parent)
    assert.ok(basename(dir).startsWith('dsh-nu-session-scan-'))
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

function run(cwd: string, args: string[]) {
  const process = spawnSync(globalThis.process.execPath, [scanner, ...args], {
    cwd, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
  })
  assert.equal(process.error, undefined)
  assert.equal(process.signal, null)
  assert.ok(!process.stdout.includes(sentinel))
  assert.ok(!process.stderr.includes(sentinel))
  return process
}

function report(cwd: string, args: string[]) {
  const process = run(cwd, args)
  assert.equal(process.status, 0, process.stderr)
  assert.equal(process.stderr, '')
  return JSON.parse(process.stdout)
}

test('JSONL CLI joins callIds and reports explicit exit and hint denominators', (t) => {
  const cwd = fixture(t)
  writeFileSync(join(cwd, 'events.jsonl'), lines([
    { type: 'session', sessionId: sentinel, cwd: sentinel },
    call('failed-hint'), call('failed-plain', 'pwsh'),
    result('failed-plain', 'Error: nu::shell::incorrect_value\n' + sentinel + '\n[exit code: 2]'),
    result('failed-hint', 'Error: nu::shell::pipeline_mismatch\nError: nu::shell::pipeline_mismatch\nNushell hint (empty-pipeline): ' + sentinel + '\nNushell hint (empty-pipeline): duplicate\n[exit code: 1]'),
    call('refusal'), result('refusal', 'Error: dsh-nu: refusing a stderr-file command.\n' + sentinel, 'error'),
    call('warning-hint'), result('warning-hint', 'Warning: nu::parser::deprecated\nNushell hint (deprecated-flag): ' + sentinel + '\n[exit code: 0]'),
    call('warning-plain'), result('warning-plain', 'Warning: nu::parser::deprecated\n' + sentinel),
    call('warning-and-error'), result('warning-and-error', 'Warning: nu::parser::deprecated\nError: nu::shell::pipeline_mismatch\nNushell hint (empty-pipeline): recovery\n[exit code: 1]'),
    call('foreign-refusal'), result('foreign-refusal', 'dsh-nu: refusing to hand this command to a foreign shell. ' + sentinel, 'error'),
    call('pending'),
    call('read-file', 'read'), result('read-file', 'Warning: nu::parser::deprecated\nNushell hint (deprecated-flag): not shell\n[exit code: 1]'),
    result('orphan', 'Nushell hint (deprecated-flag): ' + sentinel + '\n[exit code: 1]'),
    { type: 'final', text: 'Error: nu::shell::error ' + sentinel },
  ]))
  const scan = report(cwd, ['events.jsonl'])
  assert.deepEqual(scan.inputs, { files: 1, jsonl: 1, evalSamples: 0 })
  assert.deepEqual(scan.totals, { events: 20, toolCalls: 9, toolResults: 9, shellCalls: 8, shellResults: 7, shellCallsWithoutResult: 1, unmatchedToolResults: 1 })
  assert.deepEqual(scan.exits, { succeeded: 1, failed: 3, unknown: 3 })
  assert.deepEqual(scan.failed, { withHints: 2, withoutHints: 1 })
  assert.deepEqual(scan.refusals, { results: 2, withoutId: 1, ids: { 'stderr-file': 1 } })
  assert.deepEqual(scan.hints, { results: 3, ids: { 'deprecated-flag': 1, 'empty-pipeline': 2 } })
  assert.deepEqual(scan.nuDiagnostics, { results: 5, ids: { 'nu::parser::deprecated': 3, 'nu::shell::incorrect_value': 1, 'nu::shell::pipeline_mismatch': 2 } })
  assert.deepEqual(scan.deprecations, { results: 3, withHint: 1, withoutHint: 2 })
})

test('eval sample CLI reads only stdout events, never envelope status or payload', (t) => {
  const cwd = fixture(t)
  writeFileSync(join(cwd, 'sample.json'), JSON.stringify({
    label: sentinel, case: sentinel, arm: 'full', sample: 1, workspace: sentinel,
    command: sentinel, status: 0, signal: null, durationMs: 1,
    stdout: lines([call('call'), result('call', sentinel, 'error')]),
    stderr: 'Warning: nu::parser::deprecated\nNushell hint (deprecated-flag): ' + sentinel,
  }, null, 2))
  const scan = report(cwd, ['sample.json'])
  assert.deepEqual(scan.inputs, { files: 1, jsonl: 0, evalSamples: 1 })
  assert.deepEqual(scan.exits, { succeeded: 0, failed: 0, unknown: 1 })
  assert.equal(scan.nuDiagnostics.results, 0)
  assert.equal(scan.deprecations.results, 0)
})

test('multiple paths combine counts with callIds scoped to each input', (t) => {
  const cwd = fixture(t)
  writeFileSync(join(cwd, 'events.jsonl'), lines([call('same'), result('same', '\n[exit code: 1]')]))
  writeFileSync(join(cwd, 'sample.json'), JSON.stringify({ stdout: lines([call('same'), result('same', '\n[exit code: 0]')]) }))
  const scan = report(cwd, ['events.jsonl', 'sample.json'])
  assert.deepEqual(scan.inputs, { files: 2, jsonl: 1, evalSamples: 1 })
  assert.equal(scan.totals.shellCalls, 2)
  assert.deepEqual(scan.exits, { succeeded: 1, failed: 1, unknown: 0 })
})

test('only bounded ID tokens and terminal exit markers contribute to output', (t) => {
  const cwd = fixture(t)
  const output = [
    '\u001b[31mError: nu::shell::io::not_found\u001b[0m',
    'Nushell hint (path-not-found): ' + sentinel,
    'Nushell hint (' + sentinel + '/private): invalid',
    'Nushell hint (' + 'a'.repeat(65) + '): invalid',
    'dsh-nu: refusing a ' + sentinel + '/private command.',
    'Error: nu::shell::' + sentinel,
    'Error: nu::shell::valid/private',
    'source quoted Warning: nu::parser::deprecated',
    '[exit code: 9]',
    'trailing output ' + sentinel,
  ].join('\n')
  writeFileSync(join(cwd, 'events.jsonl'), lines([
    call('tokens'), result('tokens', output),
    call('signal'), result('signal', '[killed by signal: SIGTERM]'),
    call('background'), result('background', 'Started background job ' + sentinel),
  ]))
  const scan = report(cwd, ['events.jsonl'])
  assert.deepEqual(scan.exits, { succeeded: 0, failed: 0, unknown: 3 })
  assert.deepEqual(scan.hints.ids, { 'path-not-found': 1 })
  assert.deepEqual(scan.nuDiagnostics.ids, { 'nu::shell::io::not_found': 1 })
  assert.deepEqual(scan.refusals.ids, {})
  assert.equal(scan.deprecations.results, 0)
})

test('empty streams and non-shell events have zero shell denominators', (t) => {
  const cwd = fixture(t)
  writeFileSync(join(cwd, 'events.jsonl'), '\n')
  writeFileSync(join(cwd, 'sample.json'), JSON.stringify({ stdout: '' }))
  writeFileSync(join(cwd, 'single.jsonl'), JSON.stringify({ type: 'final', text: sentinel }))
  const scan = report(cwd, ['events.jsonl', 'sample.json', 'single.jsonl'])
  assert.equal(scan.totals.events, 1)
  assert.equal(scan.totals.shellResults, 0)
  assert.deepEqual(scan.exits, { succeeded: 0, failed: 0, unknown: 0 })
})

test('malformed inputs fail atomically with locations but no source excerpts', (t) => {
  const cwd = fixture(t)
  writeFileSync(join(cwd, 'valid.jsonl'), lines([call('ok'), result('ok', '[exit code: 0]')]))
  const invalidInputs: Array<[string, RegExp]> = [
    ['{"type":"final"}\n{"type":' + sentinel, /input 2 line 2: invalid JSON/],
    [JSON.stringify({ stdout: 'valid-looking ' + sentinel }), /input 2 stdout line 1: invalid JSON/],
    [JSON.stringify({ stdout: 42, command: sentinel }), /input 2: eval sample needs a string stdout/],
    [JSON.stringify([sentinel]), /expected an event object/],
    [JSON.stringify({ unrelated: sentinel }), /expected an event object/],
    [JSON.stringify({ type: 'tool_call', tool: 'bash', input: sentinel }), /tool event needs a callId/],
    [JSON.stringify({ type: 'tool_call', callId: sentinel }), /tool_call needs a tool name/],
    [JSON.stringify({ type: 'tool_result', callId: 'x', result: { private: sentinel } }), /tool_result needs a string result/],
    [lines([call(sentinel), call(sentinel)]), /duplicate tool_call callId/],
    [lines([result(sentinel, ''), result(sentinel, '')]), /duplicate tool_result callId/],
  ]
  for (const [text, expected] of invalidInputs) {
    writeFileSync(join(cwd, sentinel + '.json'), text)
    const process = run(cwd, ['valid.jsonl', sentinel + '.json'])
    assert.equal(process.status, 1)
    assert.equal(process.stdout, '')
    assert.match(process.stderr, expected)
  }
})

test('CLI help, explicit filenames, and input errors never discover directories', (t) => {
  const cwd = fixture(t)
  const help = run(cwd, ['--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /^Usage: node dev\/session-scan\.mjs/)
  assert.equal(help.stderr, '')
  writeFileSync(join(cwd, '-events.jsonl'), '')
  assert.equal(report(cwd, ['./-events.jsonl']).inputs.files, 1)
  for (const args of [[], ['--unknown'], ['--help', 'events.jsonl'], [sentinel + '.missing'], ['.']]) {
    const process = run(cwd, args)
    assert.equal(process.status, 1)
    assert.equal(process.stdout, '')
    assert.match(process.stderr, /^session-scan: /)
  }
})
