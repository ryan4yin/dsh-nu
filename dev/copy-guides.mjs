import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/guides')
const target = resolve(root, 'dist/guides')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const name of ['rules.md', 'full.md', 'compact.md', 'tool-description.md']) {
  cpSync(resolve(source, name), resolve(target, name))
}
