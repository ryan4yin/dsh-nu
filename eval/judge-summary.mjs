#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error('--' + name + ' needs a value')
  return value
}

function allArgs(name) {
  const values = []
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--' + name && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) values.push(process.argv[i + 1])
  }
  return values
}

const out = resolve(arg('out', '.work/eval-judge-summary'))
const dirs = allArgs('dir').map((path) => resolve(path))
if (dirs.length === 0) throw new Error('usage: judge-summary.mjs --dir <judge-output-dir> [--dir ...]')
mkdirSync(out, { recursive: true })

const rows = []
for (const dir of dirs) {
  for (const file of readdirSync(dir).filter((name) => name.startsWith('judge-') && name.endsWith('.json'))) {
    const payload = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    for (const row of payload.rows) rows.push({ judge: payload.label, ...row })
  }
}

const keys = new Map()
for (const row of rows) {
  const key = [row.actor, row.case, row.arm, row.sample].join('|')
  keys.set(key, { actor: row.actor, case: row.case, arm: row.arm, sample: row.sample })
}
const scores = new Map()
for (const row of rows) {
  if (row.actor === row.judge || row.score === null) continue
  const key = [row.actor, row.case, row.arm, row.sample].join('|')
  const list = scores.get(key) ?? []
  list.push({ judge: row.judge, score: row.score })
  scores.set(key, list)
}

const cells = {}
for (const [key, item] of keys) {
  const list = scores.get(key) ?? []
  if (list.length === 0) continue
  cells[item.actor] ??= {}
  cells[item.actor][item.arm] ??= []
  cells[item.actor][item.arm].push(list.reduce((sum, entry) => sum + entry.score, 0) / list.length)
}

const summary = {
  generatedAt: new Date().toISOString(),
  judges: [...new Set(rows.map((row) => row.judge))],
  actors: [...new Set(rows.map((row) => row.actor))],
  cells: Object.fromEntries(Object.entries(cells).map(([actor, arms]) => [actor, Object.fromEntries(Object.entries(arms).map(([arm, values]) => [arm, {
    samples: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  }]))])),
}
writeFileSync(join(out, 'judge-summary.json'), JSON.stringify(summary, null, 2) + '\n')
const lines = [
  '# Judge summary',
  '',
  'Generated: ' + summary.generatedAt,
  '',
  'Mean judge score (0-2) from judges other than the actor, per anonymised sample set.',
  '',
  '| actor | arm | samples | mean |',
  '|---|---|---:|---:|',
  ...Object.entries(summary.cells).flatMap(([actor, arms]) => Object.entries(arms).map(([arm, cell]) =>
    '| ' + actor + ' | ' + arm + ' | ' + cell.samples + ' | ' + cell.mean.toFixed(2) + ' |')),
]
writeFileSync(join(out, 'judge-summary.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
