import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

const FILES = [
  'README.md',
  'docs/zh/README.md',
  'docs/why.md',
  'docs/zh/why.md',
  'docs/troubleshooting.md',
  'docs/zh/troubleshooting.md',
  'docs/verification.md',
  'docs/zh/verification.md',
  'docs/nushell-friction-review.md',
  'docs/zh/nushell-friction-review.md',
  'docs/adr/0001-distribution-and-support.md',
  'docs/adr/0002-tested-teaching-claims.md',
  'docs/adr/0003-e2e-first-verification.md',
  'examples/preset-nu-shell.md',
  'cordis.patch.yml',
]

test('the documentation set exists', () => {
  for (const file of FILES) assert.ok(existsSync(resolve(ROOT, file)), file)
})

test('the documentation contains no serialization placeholders', () => {
  for (const file of FILES.filter((entry) => entry.endsWith('.md'))) {
    assert.doesNotMatch(read(file), /@BT@/, file)
  }
})

test('the tested versions are repeated in the places the user reads', () => {
  for (const file of ['README.md', 'docs/zh/README.md', 'docs/verification.md', 'docs/zh/verification.md']) {
    const text = read(file)
    assert.match(text, /0\.2\.2-alpha\.2/, file)
    assert.match(text, /0\.116\.1/, file)
  }
  const manifest = JSON.parse(read('package.json')) as { testedWith: { dsh: string; nushell: string } }
  assert.equal(manifest.testedWith.dsh, '0.2.2-alpha.2')
  assert.equal(manifest.testedWith.nushell, '0.116.1')
})

test('the README configuration example names the bundle rows', () => {
  const patch = read('cordis.patch.yml')
  for (const file of ['README.md', 'docs/zh/README.md']) {
    const text = read(file)
    for (const id of ['nu-executor', 'nu-tool-bash', 'nu-teaching']) {
      assert.match(text, new RegExp('- id: ' + id + '\\b'), file + ' mounts ' + id)
      assert.ok(patch.includes('- id: ' + id), 'cordis.patch.yml mounts ' + id)
    }
    assert.doesNotMatch(text, /- id: nushell-(?:executor|teaching)\b/, file)
  }
})

test('relative markdown links resolve', () => {
  for (const file of FILES.filter((entry) => entry.endsWith('.md'))) {
    const text = read(file)
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]!
      if (/^(https?:|mailto:|#)/.test(target)) continue
      const path = target.split('#')[0]!
      assert.ok(existsSync(resolve(ROOT, dirname(file), path)), file + ' -> ' + target)
    }
  }
})
