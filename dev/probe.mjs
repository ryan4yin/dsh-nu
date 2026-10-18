#!/usr/bin/env node
// Integration probe: boot a real dsh profile with this package mounted and
// inspect the composed plugin tree. Requires a dsh executable on PATH, or in
// DSH_INTEGRATION_CLI, and a built dist/ (npm run build).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORK = join(ROOT, '.tmp-probe')
const HOME = join(WORK, 'home')
const PROFILE = 'nu-probe'
const PROFILE_DIR = join(HOME, 'profiles', PROFILE)
const CLI = process.env.DSH_INTEGRATION_CLI ?? 'dsh'

function fail(message) {
  console.error('probe: ' + message)
  process.exit(1)
}

if (!existsSync(join(ROOT, 'dist', 'executor.js'))) fail('dist/ is missing; run npm run build first')
if (!existsSync(join(ROOT, 'node_modules', '@deepseek-ai', 'cordis'))) fail('peer packages are missing; run npm install and node dev/link-peers.mjs first')

rmSync(WORK, { recursive: true, force: true })
mkdirSync(join(PROFILE_DIR, 'node_modules'), { recursive: true })
writeFileSync(
  join(PROFILE_DIR, 'package.json'),
  JSON.stringify(
    {
      name: PROFILE,
      private: true,
      dependencies: { 'dsh-nu': 'file:../../..' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-nu'] } },
    },
    null,
    2,
  ) + '\n',
)
symlinkSync(ROOT, join(PROFILE_DIR, 'node_modules', 'dsh-nu'), 'dir')

let output
try {
  output = execFileSync(CLI, ['--profile', PROFILE, '--dump-config'], {
    cwd: PROFILE_DIR,
    env: { ...process.env, DSH_HOME: HOME },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  fail('dsh could not compose the profile: ' + (error.stderr || error.message).trim())
}

const checks = [
  [/nu-executor/, 'nu-executor row'],
  [/dsh-nu\/executor/, 'executor plugin'],
  [/nu-teaching/, 'nu-teaching row'],
  [/dsh-nu\/teaching/, 'teaching plugin'],
]
for (const [pattern, label] of checks) {
  if (!pattern.test(output)) fail('composed config is missing the ' + label)
}
if (/bash-sandbox/.test(output) && !/bash-sandbox[\s\S]{0,120}disabled/.test(output)) {
  fail('bash-sandbox is still enabled in the composed config')
}
console.log('probe: composed profile with dsh-nu (executor + teaching mounted)')
