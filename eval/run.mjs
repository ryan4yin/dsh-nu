#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findHandoff } from '../src/guard.ts'
import { findHabit } from '../src/dialect.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error('--' + name + ' needs a value')
  return value
}

function flag(name) {
  return process.argv.includes('--' + name)
}

const dshHomeArg = arg('dsh-home', '')
const modelPatchArg = arg('model-patch', '')
const dshHome = resolve(dshHomeArg)
const modelPatch = resolve(modelPatchArg)
const out = resolve(arg('out', join(repo, '.work', 'eval-runs')))
const dsh = arg('dsh', 'dsh')
const packagePath = resolve(arg('package', repo))
const profile = arg('profile', 'dsh-nu-eval')
const label = arg('label', modelPatch.split('/').at(-1) ?? 'model')
const samples = Number(arg('samples', '1'))
const arms = arg('arms', 'full,off').split(',').filter(Boolean)
const onlyCases = arg('cases', '') ? arg('cases').split(',') : []
const timeoutMs = Number(arg('timeout-ms', '240000'))
const skipInstall = flag('skip-install')
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).filter((item) => onlyCases.length === 0 || onlyCases.includes(item.id))

if (!dshHomeArg || !modelPatchArg) throw new Error('usage: run.mjs --dsh-home <dir> --model-patch <file> [--out <dir>]')
if (!existsSync(dshHome)) throw new Error('dsh home does not exist: ' + dshHome)
if (!existsSync(modelPatch)) throw new Error('model patch does not exist: ' + modelPatch)

mkdirSync(out, { recursive: true })
const env = {
  ...process.env,
  DSH_HOME: dshHome,
  PNPM_HOME: join(out, 'pnpm'),
  XDG_DATA_HOME: join(out, 'xdg-data'),
  XDG_CACHE_HOME: join(out, 'xdg-cache'),
}
mkdirSync(env.PNPM_HOME, { recursive: true })
mkdirSync(env.XDG_DATA_HOME, { recursive: true })
mkdirSync(env.XDG_CACHE_HOME, { recursive: true })
const teachingOffPatch = join(out, 'teaching-off.yml')
if (!existsSync(teachingOffPatch)) writeFileSync(teachingOffPatch, readFileSync(join(here, 'teaching-off.yml'), 'utf8'))

function run(command, args, options = {}) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repo,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? String(result.error) : undefined,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - started,
  }
}

function ensureProfile() {
  const profileDir = join(dshHome, 'profiles', profile)
  if (!existsSync(join(profileDir, 'package.json'))) {
    const init = run(dsh, ['--profile', profile, '--from-default-profile', 'headless', '--help'])
    if (init.status !== 0) throw new Error('failed to create profile: ' + init.stderr)
  }
  if (skipInstall) return
  const install = run(dsh, ['plugin', '--profile', profile, 'add', packagePath])
  if (install.status !== 0) throw new Error('failed to install dsh-nu: ' + install.stderr + install.stdout)
}

function fixtureWorkspace(item, arm, sample) {
  const workspace = join(out, 'workspaces', item.id, arm, 'sample-' + sample)
  mkdirSync(workspace, { recursive: true })
  for (const [relative, content] of Object.entries(item.fixtures ?? {})) {
    const target = join(workspace, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return workspace
}

function eventsFrom(stdout) {
  const events = []
  const bad = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      bad.push(line.slice(0, 200))
    }
  }
  return { events, bad }
}

function grade(item, events) {
  const calls = events.filter((event) => event.type === 'tool_call' && (event.tool === 'bash' || event.tool === 'pwsh'))
  const commands = calls.map((event) => String(event.input?.command ?? ''))
  const results = events.filter((event) => event.type === 'tool_result')
  const finalText = [...events].reverse().find((event) => event.type === 'final')?.text ?? ''
  const findings = commands.map((command) => {
    const handoff = findHandoff(command)
    const habit = findHabit(command)
    return {
      command,
      handoff: handoff ? handoff.shell : undefined,
      habit: habit ? habit.id : undefined,
      clean: !handoff && !habit,
    }
  })
  const refused = results.filter((event) => /dsh-nu: refusing/.test(String(event.result ?? ''))).length
  const hints = results.filter((event) => /Nushell hint \(/.test(String(event.result ?? ''))).length
  const answerMatched = new RegExp(item.expect.finalMatches, 'i').test(finalText)
  const withinCalls = commands.length >= (item.minShellCalls ?? 0) && commands.length <= (item.maxShellCalls ?? Infinity)
  const firstClean = findings.length > 0 && findings[0].clean
  const tokenCount = events
    .filter((event) => event.type === 'status' && event.phase === 'step_end' && event.usage)
    .reduce((sum, event) => sum + (Number(event.usage.totalTokens) || 0), 0)
  return {
    taskSuccess: answerMatched && withinCalls,
    answerMatched,
    withinCalls,
    shellCalls: commands.length,
    firstClean,
    violations: findings.filter((finding) => !finding.clean).length,
    refused,
    hints,
    tokenCount,
    findings,
    finalText,
  }
}

function writeSample(item, arm, sample, workspace, result) {
  const dir = join(out, 'samples', item.id, arm)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sample-' + sample + '.json'), JSON.stringify({
    label,
    case: item.id,
    arm,
    sample,
    workspace,
    command: result.command,
    status: result.status,
    signal: result.signal,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
  }, null, 2) + '\n')
}

function aggregate(rows) {
  const byArm = {}
  for (const arm of arms) {
    const cell = rows.filter((row) => row.arm === arm)
    const sum = (key) => cell.filter((row) => row[key]).length
    byArm[arm] = {
      samples: cell.length,
      taskSuccess: sum('taskSuccess'),
      answerMatched: sum('answerMatched'),
      firstClean: sum('firstClean'),
      violations: cell.reduce((total, row) => total + row.violations, 0),
      refused: cell.reduce((total, row) => total + row.refused, 0),
      hints: cell.reduce((total, row) => total + row.hints, 0),
      shellCalls: cell.reduce((total, row) => total + row.shellCalls, 0),
      tokenCount: cell.reduce((total, row) => total + row.tokenCount, 0),
    }
  }
  return byArm
}

ensureProfile()
const rows = []
for (const item of cases) {
  for (const arm of arms) {
    for (let sample = 1; sample <= samples; sample += 1) {
      const workspace = fixtureWorkspace(item, arm, sample)
      const args = ['--profile', profile, '--patch', modelPatch]
      if (arm === 'off') args.push('--patch', teachingOffPatch)
      args.push('--json', item.prompt)
      const result = run(dsh, args, { cwd: workspace })
      const parsed = eventsFrom(result.stdout)
      const graded = grade(item, parsed.events)
      const row = {
        case: item.id,
        arm,
        sample,
        status: result.status,
        durationMs: result.durationMs,
        badEventLines: parsed.bad,
        ...graded,
      }
      rows.push(row)
      writeSample(item, arm, sample, workspace, { ...result, command: [dsh, ...args].join(' ') })
      console.log(item.id + ' ' + arm + ' #' + sample + ': ' + (graded.taskSuccess ? 'pass' : 'fail') +
        ' calls=' + graded.shellCalls + ' clean=' + graded.firstClean +
        ' violations=' + graded.violations + ' refused=' + graded.refused +
        ' tokens=' + graded.tokenCount)
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  label,
  dsh,
  dshHome,
  profile,
  package: packagePath,
  modelPatch,
  samples,
  arms,
  cases: cases.map((item) => item.id),
  aggregate: aggregate(rows),
  rows,
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
const md = [
  '# Teaching eval: ' + label,
  '',
  'Generated: ' + summary.generatedAt,
  '',
  '| case | arm | n | success | first clean | violations | refused | tokens |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
  ...cases.flatMap((item) => arms.map((arm) => {
    const cell = rows.filter((row) => row.case === item.id && row.arm === arm)
    const success = cell.filter((row) => row.taskSuccess).length
    const clean = cell.filter((row) => row.firstClean).length
    const violations = cell.reduce((total, row) => total + row.violations, 0)
    const refused = cell.reduce((total, row) => total + row.refused, 0)
    const tokens = cell.reduce((total, row) => total + row.tokenCount, 0)
    return '| ' + item.id + ' | ' + arm + ' | ' + cell.length + ' | ' + success + ' | ' + clean + ' | ' + violations + ' | ' + refused + ' | ' + tokens + ' |'
  })),
  '',
  '## Aggregate',
  '',
  '| arm | samples | success | first clean | violations | refused | tokens |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...Object.entries(summary.aggregate).map(([arm, cell]) =>
    '| ' + arm + ' | ' + cell.samples + ' | ' + cell.taskSuccess + ' | ' + cell.firstClean + ' | ' + cell.violations + ' | ' + cell.refused + ' | ' + cell.tokenCount + ' |'),
  '',
  'Raw events are under ' + out + '/samples; they are deliberately not committed.',
].join('\n')
writeFileSync(join(out, 'summary.md'), md + '\n')
console.log('\n' + md)
