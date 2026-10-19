/**
 * PATH-shim fuzz: every command the preflight allows is executed through the
 * real Nushell with fake foreign shells first on PATH. If one of those shims
 * runs, the preflight missed a handoff. The corpus is deterministic, so a
 * failure is reproducible from the seed in the message.
 *
 * Linux only: the shims are POSIX scripts, and this is the CI job that runs
 * them. The differential unit tests already run on the other platforms.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findHandoff } from '../src/guard.ts'
import { findSyntaxIssue } from '../src/syntax.ts'

const SHELLS = ['bash', 'sh', 'dash', 'zsh', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd'] as const
const EMPTY_MARKER = ''

/** Deterministic PRNG; a failure prints the seed and the command. */
function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Shell names, paths, and launcher chains that are real handoffs. */
function handoffCorpus(random: () => number): string[] {
  const shell = SHELLS[Math.floor(random() * SHELLS.length)]!
  const script = `echo dsh-nu-fuzz-${Math.floor(random() * 1000)}`
  const quoted = `'${script}'`
  const templates = [
    `${shell} -c ${quoted}`,
    `/bin/${shell} -c ${quoted}`,
    `^${shell} -c ${quoted}`,
    `do { ${shell} -c ${quoted} }`,
    `if true { ${shell} -c ${quoted} }`,
    `let x = (${shell} -c ${quoted})`,
    `print x | ${shell} -c ${quoted}`,
    `print $"a(${shell} -c ${quoted})b"`,
    `print $'(${shell} -c ${quoted})'`,
    `env -S "${shell} -c ${script}"`,
    `env --split-string="${shell} -c ${script}"`,
    `env FOO=1 ${shell} -c ${quoted}`,
    `xargs ${shell} -c ${quoted}`,
    `timeout 5 ${shell} -c ${quoted}`,
    `nice -n 5 ${shell} -c ${quoted}`,
    `sudo -u root ${shell} -c ${quoted}`,
    `busybox ${shell} -c ${quoted}`,
    `run-external ${shell} -- -c ${quoted}`,
    `nu -c ${JSON.stringify(`${shell} -c ${script}`)}`,
    `FOO=1 ${shell} -c ${quoted}`,
    `do { env ${shell} -c ${quoted} }`,
    `exec ${shell} -c ${quoted}`,
    `taskset 0x3 ${shell} -c ${quoted}`,
    `taskset -c 0-3 ${shell} -c ${quoted}`,
    `taskset -c0-3 ${shell} -c ${quoted}`,
    `flock /tmp/dsh-nu-fuzz.lock ${shell} -c ${quoted}`,
    `flock --timeout 1 /tmp/dsh-nu-fuzz.lock ${shell} -c ${quoted}`,
    `flock -c '${shell} -c ${script}'`,
    `run-external env ${shell}`,
    `run-external timeout 5 ${shell} -c ${quoted}`,
    `env -S "-u FOO ${shell} -c ${script}"`,
    `env -S "FOO=1 timeout 5 ${shell} -c ${script}"`,
    `do { def ${shell} [] { print custom } }; ${shell} -c ${quoted}`,
    `env -S r#'${shell} -c "${script}"'#`,
    `nu -c r#'${shell} -c "${script}"'#`,
    `nu --commands='${shell} -c "${script}"'`,
    `nu -e ${JSON.stringify(`${shell} -c ${script}`)}`,
    `ionice -c 3 ${shell} -c ${quoted}`,
    `timeout $env.PATH ${shell} -c ${quoted}`,
  ]
  return templates
}

/** Commands a real agent writes that are not handoffs; all must run cleanly. */
function allowedCorpus(): string[] {
  return [
    'print hi',
    'ls | length',
    "print 'bash -c echo hi'",
    'print "bash -c echo hi"',
    "print r#'bash -c echo hi'#",
    "'bash -c \"echo hi\"' | save -f out.txt; open --raw out.txt | str trim",
    'timeout 5 echo bash',
    'env echo bash',
    'env FOO=1 echo bash',
    'def sh [] { print custom }; sh',
    'let prog = "echo"; run-external $prog -- bash',
    'print bash',
    'print "env -S bash"',
    'do { print hi }',
  ]
}

function makeShims(root: string, marker: string): string {
  const bin = join(root, 'bin')
  mkdirSync(bin)
  for (const shell of SHELLS) {
    const path = join(bin, shell)
    writeFileSync(path, '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$DSH_NU_FUZZ_MARKER"\nexit 0\n')
    chmodSync(path, 0o755)
  }
  writeFileSync(marker, EMPTY_MARKER)
  return bin
}

function runNu(command: string, cwd: string, path: string, marker: string): { status: number | null; stderr: string } {
  const result = spawnSync('nu', ['--no-config-file', '-c', command], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: path + ':' + (process.env.PATH ?? ''), DSH_NU_FUZZ_MARKER: marker },
    timeout: 20_000,
  })
  return { status: result.status, stderr: String(result.stderr ?? '') }
}

test('no allowed fuzz command runs a foreign shell', { skip: process.platform !== 'linux' }, async (t) => {
  const probe = spawnSync('nu', ['--version'], { encoding: 'utf8' })
  if (probe.error !== undefined) {
    t.skip('nu is not installed: ' + String(probe.error))
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'dsh-nu-fuzz-'))
  const marker = join(root, 'marker')
  const bin = makeShims(root, marker)
  try {
    const random = mulberry32(0x5eed)
    const commands = [...handoffCorpus(random), ...allowedCorpus()]
    for (let index = commands.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1))
      ;[commands[index], commands[swap]] = [commands[swap]!, commands[index]!]
    }
    for (const command of commands) {
      const handoff = await findHandoff(command)
      const syntax = await findSyntaxIssue(command)
      if (handoff !== undefined || syntax !== undefined) continue
      writeFileSync(marker, EMPTY_MARKER)
      const result = runNu(command, root, bin, marker)
      const calls = readFileSync(marker, 'utf8').trim()
      assert.equal(
        calls,
        '',
        'preflight allowed ' + JSON.stringify(command) + ' but a foreign shell ran (' + calls.replace(/\n/g, ' ') + '); status ' + String(result.status),
      )
      assert.equal(result.status, 0, 'allowed command failed: ' + command + '\n' + result.stderr.slice(0, 300))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the curated allowed corpus really is clean', { skip: process.platform !== 'linux' }, async (t) => {
  const probe = spawnSync('nu', ['--version'], { encoding: 'utf8' })
  if (probe.error !== undefined) {
    t.skip('nu is not installed: ' + String(probe.error))
    return
  }
  for (const command of allowedCorpus()) {
    assert.equal(await findHandoff(command), undefined, command)
    assert.equal(await findSyntaxIssue(command), undefined, command)
  }
})
