/**
 * Knowledge about the Nushell executable: how it is chosen, how a command
 * becomes an argv, and what the boot probe learned.
 */

import { readFileSync } from 'node:fs'

/** The flags every command runs behind; the command itself is appended last. */
export const DEFAULT_NU_ARGS = ['--no-config-file', '-c'] as const

/** Where the executable setting came from, for diagnostics. */
export type NuOrigin = 'config' | 'environment' | 'path'

/** The executable one command will spawn as. */
export interface NuChoice {
  binary: string
  origin: NuOrigin
}

/** Facts the executor records at boot and the teaching layer reads back. */
export interface NuFacts {
  binary: string
  origin: NuOrigin | undefined
  resolvedPath: string | undefined
  version: string | undefined
  problem: string | undefined
}

/**
 * One process hosts one composed shell service, so these facts are module
 * state. The teaching layer reads them from a prompt builder, which runs after
 * the executor's boot hook.
 */
export const nuFacts: NuFacts = {
  binary: 'nu',
  origin: undefined,
  resolvedPath: undefined,
  version: undefined,
  problem: undefined,
}

/** The Nushell version this release is tested against, read from the manifest. */
export const TESTED_NUSHELL: string | undefined = (() => {
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const value = typeof manifest === 'object' && manifest !== null
      ? (manifest as { testedWith?: { nushell?: unknown } }).testedWith?.nushell
      : undefined
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
})()

/** Pick the executable: explicit config, then DSH_NU_PATH, then PATH lookup. */
export function chooseBinary(configured: unknown, env: Record<string, string | undefined> = process.env): NuChoice {
  if (typeof configured === 'string' && configured.trim().length > 0) return { binary: configured.trim(), origin: 'config' }
  const fromEnv = env.DSH_NU_PATH
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return { binary: fromEnv.trim(), origin: 'environment' }
  return { binary: 'nu', origin: 'path' }
}

/** Validate an argv prefix. The command is always appended, so it must end at -c. */
export function normalizePrefix(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [...DEFAULT_NU_ARGS]
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((entry) => typeof entry === 'string')) {
    throw new Error('dsh-nu: nuArgs must be a non-empty array of strings')
  }
  return [...(raw as string[])]
}

/** The argv one command runs as. */
export function commandArgv(command: string, choice: NuChoice, prefix: readonly string[] = DEFAULT_NU_ARGS): string[] {
  return [choice.binary, ...prefix, command]
}

/** Extract x.y.z from arbitrary nu --version output. */
export function parseVersion(output: unknown): string | undefined {
  if (typeof output !== 'string') return undefined
  const found = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  return found === null ? undefined : found[1] + '.' + found[2] + '.' + found[3]
}
