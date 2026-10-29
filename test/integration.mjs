#!/usr/bin/env node
// Real dsh boot: mount this package and a probe plugin in a scratch profile,
// boot the real CLI, and let the probe observe the live composition.
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

const requested = process.argv.slice(2).filter((arg) => arg === '--native' || arg === '--ptc')
const modes = requested.length > 0 ? requested.map((flag) => flag === '--ptc' ? 'ptc' : 'native') : ['native', 'ptc']
const home = mkdtempSync(join(tmpdir(), 'dsh-nu-integration-'))
let failed = false

function boot(mode) {
  const profile = 'nuprobe-' + mode
  const profileDir = join(home, 'profiles', profile)
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: profile,
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-nu'] } },
  }, null, 2) + '\n')
  symlinkSync(ROOT, join(profileDir, 'node_modules', 'dsh-nu'), 'dir')
  copyFileSync(join(ROOT, 'test', 'integration', 'probe.mjs'), join(profileDir, 'probe.mjs'))
  const patch = mode === 'ptc'
    ? [
        '- id: nu-native-tool-executor',
        '  disabled: true',
        '- id: tool-executor-ptc',
        '  disabled: false',
        '- insert:',
        '    - id: nu-probe',
        '      name: ./probe.mjs',
        '',
      ]
    : ['- insert:', '    - id: nu-probe', '      name: ./probe.mjs', '']
  writeFileSync(join(profileDir, 'cordis.patch.yml'), patch.join('\n'))
  const workdir = join(profileDir, 'probe-workdir')
  mkdirSync(workdir, { recursive: true })

  const result = spawnSync(dsh, ['--profile', profile], {
    cwd: profileDir,
    env: { ...process.env, DSH_HOME: home, DSH_NU_PROBE_WORKDIR: workdir, DSH_NU_PROBE_PTC: mode === 'ptc' ? '1' : '0' },
    encoding: 'utf8',
    timeout: 300_000,
  })
  console.log('integration: --- ' + mode + ' dsh output ---')
  console.log((result.stdout ?? '').trim())
  if ((result.stderr ?? '').trim().length > 0) console.log('integration: --- ' + mode + ' dsh stderr ---\n' + result.stderr.trim())
  console.log('integration: --- ' + mode + ' end ---')
  if (result.status !== 0 || !(result.stdout ?? '').includes('PROBE OK')) {
    console.error('integration: ' + mode + ' FAILED (exit ' + result.status + ')')
    failed = true
  } else {
    console.log('integration: ' + mode + ' PASSED')
  }
}

for (const mode of modes) boot(mode)
if (failed) {
  console.error('integration: scratch home kept at ' + home)
  process.exit(1)
}
rmSync(home, { recursive: true, force: true })
