#!/usr/bin/env node
// Real dsh boot: install this package into a scratch profile, mount a probe
// plugin beside it, and let the probe observe the live composition.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dsh = process.env.DSH_INTEGRATION_CLI
  ?? (existsSync(join(ROOT, 'node_modules', '.bin', 'dsh')) ? join(ROOT, 'node_modules', '.bin', 'dsh') : 'dsh')
if (!existsSync(join(ROOT, 'dist', 'executor.js'))) {
  console.error('integration: dist/ is missing; run npm run build first')
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), 'dsh-nu-integration-'))
const profile = 'nuprobe'
const profileDir = join(home, 'profiles', profile)
mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: profile,
  private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-nu'] } },
}, null, 2) + '\n')
symlinkSync(ROOT, join(profileDir, 'node_modules', 'dsh-nu'), 'dir')
copyFileSync(join(ROOT, 'test', 'integration', 'probe.mjs'), join(profileDir, 'probe.mjs'))
writeFileSync(join(profileDir, 'cordis.patch.yml'), [
  '- insert:',
  '    - id: nu-probe',
  '      name: ./probe.mjs',
  '',
].join('\n'))

const result = spawnSync(dsh, ['--profile', profile], {
  cwd: profileDir,
  env: { ...process.env, DSH_HOME: home },
  encoding: 'utf8',
  timeout: 300_000,
})
console.log('integration: --- dsh output ---')
console.log((result.stdout ?? '').trim())
if ((result.stderr ?? '').trim().length > 0) console.log('integration: --- dsh stderr ---\n' + result.stderr.trim())
console.log('integration: --- end ---')
const ok = result.status === 0 && (result.stdout ?? '').includes('PROBE OK')
if (ok) {
  console.log('integration: PASSED')
  rmSync(home, { recursive: true, force: true })
  process.exit(0)
}
console.error('integration: FAILED (exit ' + result.status + '); scratch home kept at ' + home)
process.exit(1)
