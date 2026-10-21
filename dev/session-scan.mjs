#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'

const usage = 'Usage: node dev/session-scan.mjs <events.jsonl|sample.json> [...]\n       node dev/session-scan.mjs --help\n'
const shellTools = new Set(['bash', 'pwsh'])

class InputError extends Error {}

function invalid(location, reason) {
  // Parser and filesystem errors can contain source text or private paths.
  throw new InputError(location + ': ' + reason)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function event(value, location) {
  if (!object(value) || typeof value.type !== 'string' || value.type.length === 0) {
    invalid(location, 'expected an event object with a type')
  }
  if (value.type === 'tool_call' || value.type === 'tool_result') {
    if (typeof value.callId !== 'string' || value.callId.length === 0) invalid(location, 'tool event needs a callId')
    if (value.type === 'tool_call' && (typeof value.tool !== 'string' || value.tool.length === 0)) {
      invalid(location, 'tool_call needs a tool name')
    }
    if (value.type === 'tool_result' && typeof value.result !== 'string') {
      invalid(location, 'tool_result needs a string result')
    }
  }
  return { value, location }
}

function jsonl(text, location) {
  const events = []
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue
    const at = location + ' line ' + (index + 1)
    let value
    try {
      value = JSON.parse(line)
    } catch {
      invalid(at, 'invalid JSON')
    }
    events.push(event(value, at))
  }
  return events
}

function readInput(path, index) {
  const location = 'input ' + index
  let text
  try {
    if (!statSync(path).isFile()) invalid(location, 'expected a regular file')
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof InputError) throw error
    invalid(location, 'cannot read file')
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { format: 'jsonl', events: jsonl(text, location) }
  }
  if (object(value) && !Object.hasOwn(value, 'type') && Object.hasOwn(value, 'stdout')) {
    if (typeof value.stdout !== 'string') invalid(location, 'eval sample needs a string stdout')
    return { format: 'evalSamples', events: jsonl(value.stdout, location + ' stdout') }
  }
  return { format: 'jsonl', events: [event(value, location)] }
}

function ids(text, pattern) {
  return new Set([...text.matchAll(pattern)].map((match) => match[1]))
}

function countIds(target, values) {
  for (const id of values) target[id] = (target[id] ?? 0) + 1
}

function countResult(report, source) {
  const text = stripVTControlCharacters(source)
  const refusalIds = ids(text, /^(?:Error: )?dsh-nu: refusing an? ([a-z][a-z0-9-]{0,63}) command\./gm)
  const hintIds = ids(text, /^Nushell hint \(([a-z][a-z0-9-]{0,63})\):/gm)
  const nuIds = ids(text, /^(?:Error|Warning): (nu::[a-z][a-z0-9_]{0,63}(?:::[a-z][a-z0-9_]{0,63}){1,4})\s*$/gm)
  const hasHint = hintIds.size > 0
  report.totals.shellResults += 1
  if (/^(?:Error: )?dsh-nu: refusing\b/m.test(text)) {
    report.refusals.results += 1
    if (refusalIds.size === 0) report.refusals.withoutId += 1
  }
  countIds(report.refusals.ids, refusalIds)
  if (hasHint) report.hints.results += 1
  countIds(report.hints.ids, hintIds)
  if (nuIds.size > 0) report.nuDiagnostics.results += 1
  countIds(report.nuDiagnostics.ids, nuIds)
  // Only the terminal status marker is evidence of the shell's exit code.
  const exit = /(?:^|\n)\[exit code: (0|[1-9][0-9]{0,8})\]\s*$/.exec(text)
  if (exit === null) {
    report.exits.unknown += 1
  } else if (Number(exit[1]) === 0) {
    report.exits.succeeded += 1
  } else {
    report.exits.failed += 1
    report.failed[hasHint ? 'withHints' : 'withoutHints'] += 1
  }
  if (/^Warning: nu::parser::deprecated\s*$/m.test(text)) {
    report.deprecations.results += 1
    report.deprecations[hintIds.has('deprecated-flag') ? 'withHint' : 'withoutHint'] += 1
  }
}

function scan(report, input) {
  report.inputs[input.format] += 1
  report.totals.events += input.events.length
  const calls = new Map()
  const results = new Map()
  for (const { value, location } of input.events) {
    if (value.type === 'tool_call') {
      if (calls.has(value.callId)) invalid(location, 'duplicate tool_call callId within input')
      calls.set(value.callId, value.tool)
      report.totals.toolCalls += 1
      if (shellTools.has(value.tool)) report.totals.shellCalls += 1
    } else if (value.type === 'tool_result') {
      if (results.has(value.callId)) invalid(location, 'duplicate tool_result callId within input')
      results.set(value.callId, value.result)
      report.totals.toolResults += 1
    }
  }
  for (const [callId, result] of results) {
    if (!calls.has(callId)) report.totals.unmatchedToolResults += 1
    else if (shellTools.has(calls.get(callId))) countResult(report, result)
  }
  for (const [callId, tool] of calls) {
    if (shellTools.has(tool) && !results.has(callId)) report.totals.shellCallsWithoutResult += 1
  }
}

function main(paths) {
  if (paths.length === 1 && paths[0] === '--help') {
    process.stdout.write(usage)
    return
  }
  if (paths.length === 0 || paths.some((path) => path.startsWith('-'))) {
    throw new InputError('provide explicit file paths (prefix names beginning with - with ./); use --help for usage')
  }
  const report = {
    schemaVersion: 1,
    inputs: { files: paths.length, jsonl: 0, evalSamples: 0 },
    totals: { events: 0, toolCalls: 0, toolResults: 0, shellCalls: 0, shellResults: 0, shellCallsWithoutResult: 0, unmatchedToolResults: 0 },
    exits: { succeeded: 0, failed: 0, unknown: 0 },
    failed: { withHints: 0, withoutHints: 0 },
    refusals: { results: 0, withoutId: 0, ids: Object.create(null) },
    hints: { results: 0, ids: Object.create(null) },
    nuDiagnostics: { results: 0, ids: Object.create(null) },
    deprecations: { results: 0, withHint: 0, withoutHint: 0 },
  }
  for (const [index, path] of paths.entries()) scan(report, readInput(path, index + 1))
  for (const section of [report.refusals, report.hints, report.nuDiagnostics]) {
    section.ids = Object.fromEntries(Object.entries(section.ids).sort(([left], [right]) => left.localeCompare(right)))
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

try {
  main(process.argv.slice(2))
} catch (error) {
  process.stderr.write('session-scan: ' + (error instanceof InputError ? error.message : 'unexpected failure') + '\n')
  process.exitCode = 1
}
