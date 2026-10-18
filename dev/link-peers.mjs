#!/usr/bin/env node
/**
 * Link the dsh peer packages from an installed dsh into this checkout.
 *
 * The test suite drives dsh's real seams, but npm must not download them: they
 * are peers supplied by the host application. This helper points
 * node_modules/@deepseek-ai/* at the packages inside a dsh installation.
 *
 * Usage: node dev/link-peers.mjs --root <dsh-install-root>
 * `<dsh-install-root>` is the dsh installation prefix; both a flat package
 * scope and the scope nested under the dsh package are accepted.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { argv } from 'node:process'

const SCOPE = '@deepseek-ai'

/** Read one flag, or fail with usage. */
function flag(name) {
  const index = argv.indexOf('--' + name)
  if (index === -1 || argv[index + 1] === undefined) return undefined
  return argv[index + 1]
}

const root = flag('root') ?? process.env.DSH_INSTALL_ROOT
if (root === undefined) {
  console.error('usage: node dev/link-peers.mjs --root <dsh-install-root>')
  process.exit(1)
}

const base = resolve(root)
const candidates = [
  join(base, 'lib', 'node_modules', SCOPE, 'dsh', 'node_modules', SCOPE),
  join(base, 'node_modules', SCOPE, 'dsh', 'node_modules', SCOPE),
  join(base, 'lib', 'node_modules', SCOPE),
]
const source = candidates.find((candidate) => existsSync(join(candidate, 'dsh-shell'))) ?? candidates.find((candidate) => existsSync(candidate))
const target = join(process.cwd(), 'node_modules', SCOPE)

if (source === undefined) {
  console.error('dsh-nu: no dsh package scope found under ' + base + '; looked in:' + candidates.map((candidate) => '\n  ' + candidate).join(''))
  process.exit(1)
}

let entries
try {
  entries = (await readdir(source)).filter((name) => !name.startsWith('.'))
} catch (error) {
  console.error('dsh-nu: cannot read ' + source + ': ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}

await mkdir(target, { recursive: true })
let linked = 0
for (const name of entries) {
  const destination = join(target, name)
  try {
    const current = await readlink(destination)
    if (resolve(current) === join(source, name)) continue
  } catch {
    // Missing or already a real directory; replace below.
  }
  await rm(destination, { recursive: true, force: true })
  await symlink(join(source, name), destination, 'dir')
  linked += 1
}
console.log('dsh-nu: linked ' + linked + ' peer package(s) from ' + source)
