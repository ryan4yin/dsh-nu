import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8')
}

function headingLevels(markdown: string): number[] {
  return markdown
    .split('\n')
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => (line.match(/^#+/) ?? [''])[0].length)
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['README.md', 'docs/zh/README.md'],
  ['docs/why.md', 'docs/zh/why.md'],
  ['docs/troubleshooting.md', 'docs/zh/troubleshooting.md'],
  ['docs/verification.md', 'docs/zh/verification.md'],
]

const FILES = [
  'README.md',
  'docs/zh/README.md',
  'docs/why.md',
  'docs/zh/why.md',
  'docs/troubleshooting.md',
  'docs/zh/troubleshooting.md',
  'docs/verification.md',
  'docs/zh/verification.md',
  'docs/adr/0001-distribution-and-support.md',
  'examples/preset-nu-shell.md',
  'cordis.patch.yml',
]

test('the documentation set exists', () => {
  for (const file of FILES) assert.ok(existsSync(resolve(ROOT, file)), file)
})

test('each English page and its Chinese mirror have the same heading structure', () => {
  for (const [en, zh] of PAIRS) {
    assert.deepEqual(headingLevels(read(zh)), headingLevels(read(en)), en + ' vs ' + zh)
  }
})

test('the tested versions are repeated in the places the user reads', () => {
  for (const file of ['README.md', 'docs/zh/README.md', 'docs/verification.md', 'docs/zh/verification.md']) {
    const text = read(file)
    assert.match(text, /0\.2\.1-rc\.2/, file)
    assert.match(text, /0\.115\.1/, file)
  }
  const manifest = JSON.parse(read('package.json')) as { testedWith: { dsh: string; nushell: string } }
  assert.equal(manifest.testedWith.dsh, '0.2.1-rc.2')
  assert.equal(manifest.testedWith.nushell, '0.115.1')
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

const UPSTREAM = ['github.com/YMRwithNoworry/dsh-nushell-only', 'github.com/deepseek-ai/deepseek-harness']

/** Everything before the acknowledgement heading. */
function beforeAcknowledgements(markdown: string): string {
  const index = markdown.search(/^## (Acknowledgements|致谢)$/m)
  return index === -1 ? markdown : markdown.slice(0, index)
}

test('upstream repositories are referenced only in the acknowledgements', () => {
  for (const file of FILES.filter((entry) => entry.endsWith('.md'))) {
    const outside = beforeAcknowledgements(read(file))
    for (const upstream of UPSTREAM) assert.ok(!outside.includes(upstream), file + ' mentions ' + upstream + ' outside acknowledgements')
  }
  const readme = read('README.md')
  const acknowledgement = readme.slice(readme.search(/^## Acknowledgements$/m))
  for (const upstream of UPSTREAM) assert.ok(acknowledgement.includes(upstream), upstream)
})

test('the README does not frame the project as a rewrite or a port', () => {
  const readme = read('README.md')
  assert.doesNotMatch(readme, /\brewrite\b|based on another|port of/i)
})
