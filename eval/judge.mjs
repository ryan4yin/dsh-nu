#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

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

function flag(name) {
  return process.argv.includes('--' + name)
}

const dshHomeArg = arg('dsh-home', '')
const modelPatchArg = arg('model-patch', '')
const dshHome = resolve(dshHomeArg)
const modelPatch = resolve(modelPatchArg)
const out = resolve(arg('out', join(repo, '.work', 'eval-judge')))
const dsh = arg('dsh', 'dsh')
const profile = arg('profile', 'dsh-nu-eval')
const label = arg('label', 'judge')
const timeoutMs = Number(arg('timeout-ms', '240000'))
const skipInstall = flag('skip-install')
const runDirs = allArgs('run').map((path) => resolve(path))
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))
const caseById = new Map(cases.map((item) => [item.id, item]))

if (!dshHomeArg || !modelPatchArg || runDirs.length === 0) throw new Error('usage: judge.mjs --run <dir> [--run <dir>] --dsh-home <dir> --model-patch <file>')
mkdirSync(out, { recursive: true })
const env = {
  ...process.env,
  DSH_HOME: dshHome,
  PNPM_HOME: join(out, 'pnpm'),
  XDG_DATA_HOME: join(out, 'xdg-data'),
  XDG_CACHE_HOME: join(out, 'xdg-cache'),
}

const teachingOff = join(out, 'teaching-off.yml')
if (!existsSync(teachingOff)) writeFileSync(teachingOff, readFileSync(join(here, 'teaching-off.yml'), 'utf8'))

function eventsFrom(stdout) {
  const events = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch {}
  }
  return events
}

function clip(value, limit) {
  const text = String(value ?? '')
  return text.length > limit ? text.slice(0, limit) + '...' : text
}

const samples = []
for (const dir of runDirs) {
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
  for (const row of summary.rows) {
    const samplePath = join(dir, 'samples', row.case, row.arm, 'sample-' + row.sample + '.json')
    if (!existsSync(samplePath)) continue
    const raw = JSON.parse(readFileSync(samplePath, 'utf8'))
    const events = eventsFrom(raw.stdout)
    const calls = events.filter((event) => event.type === 'tool_call' && (event.tool === 'bash' || event.tool === 'pwsh'))
    const results = events.filter((event) => event.type === 'tool_result')
    const finalText = [...events].reverse().find((event) => event.type === 'final')?.text ?? ''
    samples.push({
      id: 'sample-' + String(samples.length + 1),
      actor: summary.label,
      case: row.case,
      arm: row.arm,
      sample: row.sample,
      task: caseById.get(row.case)?.prompt ?? row.case,
      final: clip(finalText, 1200),
      commands: calls.map((event) => clip(event.input?.command ?? '', 500)),
      results: results.map((event) => clip(event.result ?? '', 500)),
    })
  }
}

const prompt = [
  'You are grading samples from a Nushell teaching evaluation. The assistant was asked to use a shell tool that runs Nushell.',
  'For each sample, score: 2 = task result is correct and the shell commands are valid Nushell with no rejected attempts; 1 = result is correct but a shell command was rejected or needed a retry; 0 = result is wrong or the assistant gave up.',
  'Judge only the final result and the command/result evidence. Do not infer from the actor model name.',
  'Return only a JSON array with one object per sample: {"id":"sample-N","score":0,"reason":"short"}. No markdown fences.',
  'Samples:',
  JSON.stringify(samples.map(({ actor, arm, ...rest }) => rest), null, 2),
].join('\n')

const args = ['--profile', profile, '--patch', modelPatch, '--patch', teachingOff, '--json', '-']
const started = Date.now()
const result = spawnSync(dsh, args, { env, cwd: out, encoding: 'utf8', timeout: timeoutMs, input: prompt, maxBuffer: 32 * 1024 * 1024 })
const events = eventsFrom(result.stdout ?? '')
const finalText = [...events].reverse().find((event) => event.type === 'final')?.text ?? ''
let scores = []
try {
  const match = finalText.match(/\[[\s\S]*\]/)
  scores = match ? JSON.parse(match[0]) : []
} catch {
  scores = []
}
const judged = new Map(scores.map((item) => [String(item.id), item]))
const rows = samples.map((sample) => ({
  ...sample,
  judge: label,
  score: Number.isFinite(Number(judged.get(sample.id)?.score)) ? Number(judged.get(sample.id).score) : null,
  reason: judged.get(sample.id)?.reason ?? 'no score returned',
}))
const summary = {
  generatedAt: new Date().toISOString(),
  label,
  modelPatch,
  status: result.status,
  durationMs: Date.now() - started,
  sampleCount: samples.length,
  scored: rows.filter((row) => row.score !== null).length,
  rows,
}
writeFileSync(join(out, 'judge-' + label + '.json'), JSON.stringify(summary, null, 2) + '\n')
const byActor = {}
for (const row of rows) {
  if (row.actor === label) continue
  byActor[row.actor] ??= []
  if (row.score !== null) byActor[row.actor].push(row.score)
}
console.log('judge ' + label + ': ' + summary.scored + '/' + summary.sampleCount + ' scored')
for (const [actor, values] of Object.entries(byActor)) {
  console.log('  ' + actor + ': ' + values.length + ' scored, mean ' + (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
}
if (summary.scored < summary.sampleCount) console.error('warning: judge did not score every sample')
