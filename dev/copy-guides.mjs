import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/guides')
const target = resolve(root, 'dist/guides')
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
