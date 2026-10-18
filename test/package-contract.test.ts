import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  version: string
  testedWith: { dsh: string; nushell: string }
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
  exports: Record<string, { default: string } | string>
  files: string[]
  engines: { node: string }
  dsh: { bundle: { patch: string } }
}

test('the package allows Node 22 but is tested on Node 24', () => {
  assert.equal(manifest.engines.node, '>=22.19.0')
})

test('the dsh peer ranges and the tested pair agree', () => {
  assert.match(manifest.testedWith.dsh, /^\d+\.\d+\.\d+(-rc\.\d+)?$/)
  assert.match(manifest.testedWith.nushell, /^\d+\.\d+\.\d+$/)
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    assert.equal(range, '^' + manifest.testedWith.dsh, name)
  }
})

test('the bundle patch mounts the exported plugins', () => {
  const patch = readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(patch, /name: dsh-nu\/executor/)
  assert.match(patch, /name: dsh-nu\/teaching/)
  for (const id of ['bash-sandbox', 'pwsh-sandbox']) {
    assert.match(patch, new RegExp('- id: ' + id + '\n  disabled: true'))
  }
})

test('the published file list ships the runtime artifacts', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  for (const entry of ['dist', 'examples', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(entry), entry)
  }
})

test('the published guides ship with the runtime', { skip: !existsSync(resolve(ROOT, 'dist')) }, () => {
  for (const name of ['command-description.md', 'compact.md', 'full.md', 'rules.md', 'tool-description.md']) {
    assert.ok(existsSync(resolve(ROOT, 'dist/guides', name)), name)
  }
})

test('exported entry points resolve to built files after a build', { skip: !existsSync(resolve(ROOT, 'dist')) }, () => {
  for (const [key, target] of Object.entries(manifest.exports)) {
    const entry = typeof target === 'string' ? target : target.default
    if (key === './package.json') continue
    assert.ok(existsSync(resolve(ROOT, entry)), key + ' -> ' + entry)
  }
})
