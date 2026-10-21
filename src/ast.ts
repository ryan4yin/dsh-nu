/**
 * Nushell's own view of a command: the flat token stream from `nu --ide-ast`
 * plus the parser diagnostics from `nu --ide-check`.
 *
 * The preflight must not approximate Nushell's grammar with a second lexer:
 * every earlier hand-written scanner bug came from that approximation. Both
 * IDE entry points are read-only CLI actions over a temporary script, so they
 * see nested blocks, closures, and string interpolations exactly as `nu -c`
 * would. The two processes run concurrently; a small LRU cache absorbs repeated
 * commands. A failure here is fatal to the command (fail closed): running a
 * command whose preflight could not run would silently drop the Nu-only
 * guarantee.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** One token from `nu --ide-ast`. Offsets are 0-based in the command text. */
export interface AstToken {
  shape: string
  content: string
  start: number
  end: number
}

/** One diagnostic from `nu --ide-check`. Offsets are 0-based in the command text. */
export interface AstDiagnostic {
  severity: string
  message: string
  start: number
  end: number
}

/** The parser's view of one command. */
export interface Analysis {
  command: string
  tokens: readonly AstToken[]
  diagnostics: readonly AstDiagnostic[]
}

/** Options for {@link analyze}. */
export interface AnalyzeOptions {
  /** The Nushell executable; defaults to `nu` on PATH. */
  binary?: string
  /** Working directory for the two probes. */
  cwd?: string
  /** Bound for each probe; defaults to 5s. */
  timeoutMs?: number
  signal?: AbortSignal
}

/** A preflight that could not run; the caller must refuse the command. */
export class PreflightError extends Error {
  override name = 'PreflightError'
}

const DEFAULT_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const CACHE_LIMIT = 128

/** Resolved analyses, keyed by binary, cwd, and command. */
const cache = new Map<string, Promise<Analysis>>()

/** Drop the cache; tests use this between cases. */
export function clearAnalysisCache(): void {
  cache.clear()
}

/** Analyze one command through Nushell's own parser. */
export function analyze(command: string, options: AnalyzeOptions = {}): Promise<Analysis> {
  const binary = options.binary ?? 'nu'
  const key = binary + '\0' + (options.cwd ?? '') + '\0' + command
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const pending = analyzeUncached(command, binary, options)
  cache.set(key, pending)
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key)
  })
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return pending
}

async function analyzeUncached(command: string, binary: string, options: AnalyzeOptions): Promise<Analysis> {
  const timeout = options.timeoutMs !== undefined && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const signal = options.signal ?? AbortSignal.timeout(timeout)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-nu-ast-'))
  try {
    const file = join(dir, 'command.nu')
    // The script is data for Nushell's parser, never executed; 0600 keeps the
    // (possibly sensitive) command text private to the current user.
    await writeFile(file, command, { mode: 0o600 })
    const [astStdout, checkStdout] = await Promise.all([
      probe(binary, ['--no-config-file', '--ide-ast', file], { cwd: options.cwd, signal }),
      probe(binary, ['--no-config-file', '--ide-check', '100', file], { cwd: options.cwd, signal }),
    ])
    const offsets = byteOffsetMap(command)
    return {
      command,
      tokens: parseTokens(astStdout, command, offsets),
      diagnostics: parseDiagnostics(checkStdout, offsets),
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function probe(binary: string, argv: string[], options: { cwd?: string | undefined; signal: AbortSignal }): Promise<string> {
  try {
    const { stdout } = await run(binary, argv, {
      cwd: options.cwd,
      signal: options.signal,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    })
    return stdout
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown'
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String((error as { stderr: unknown }).stderr) : ''
    const detail = stderr.trim() !== '' ? stderr.trim().slice(0, 300) : 'exit ' + code
    throw new PreflightError('nu ' + argv.slice(1, 3).join(' ') + ' failed: ' + detail)
  }
}

/**
 * The IDE entry points report UTF-8 byte offsets; JavaScript indexes UTF-16
 * code units. Map every byte boundary to the string index that starts the
 * character there, so non-ASCII text before a token cannot shift it.
 */
function byteOffsetMap(command: string): number[] {
  const bytes = Buffer.byteLength(command, 'utf8')
  const map = new Array<number>(bytes + 1).fill(0)
  let byte = 0
  for (let index = 0; index < command.length;) {
    const char = String.fromCodePoint(command.codePointAt(index)!)
    const width = Buffer.byteLength(char, 'utf8')
    for (let offset = 0; offset < width; offset += 1) map[byte + offset] = index
    byte += width
    index += char.length
  }
  map[bytes] = command.length
  return map
}

function parseTokens(stdout: string, command: string, offsets: readonly number[]): AstToken[] {
  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    throw new PreflightError('nu --ide-ast did not return JSON')
  }
  if (!Array.isArray(raw)) throw new PreflightError('nu --ide-ast returned ' + typeof raw + ', not a token list')
  const tokens: AstToken[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const token = item as Record<string, unknown>
    if (typeof token.shape !== 'string' || typeof token.content !== 'string') continue
    const span = token.span as Record<string, unknown> | undefined
    const fromByte = typeof span?.start === 'number' ? span.start : undefined
    const toByte = typeof span?.end === 'number' ? span.end : undefined
    if (fromByte === undefined || toByte === undefined) continue
    const from = offsets[fromByte]
    const to = offsets[toByte]
    if (from === undefined || to === undefined || from < 0 || to > command.length || from > to) continue
    tokens.push({ shape: token.shape, content: token.content, start: from, end: to })
  }
  return tokens
}

function parseDiagnostics(stdout: string, offsets: readonly number[]): AstDiagnostic[] {
  const bytes = offsets.length - 1
  const diagnostics: AstDiagnostic[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    if (entry.type !== 'diagnostic' || typeof entry.message !== 'string') continue
    const span = entry.span as Record<string, unknown> | undefined
    const startByte = typeof span?.start === 'number' ? span.start : 0
    const endByte = typeof span?.end === 'number' ? span.end : startByte
    // A span past the command belongs to a file it loads (`source`, `use`).
    if (startByte < 0 || endByte > bytes || startByte > endByte) continue
    const start = offsets[startByte]!
    const end = offsets[endByte]!
    diagnostics.push({
      severity: typeof entry.severity === 'string' ? entry.severity : 'Error',
      message: entry.message,
      start,
      end,
    })
  }
  return diagnostics
}

/** Whether a token is a plain literal string (single-, double-, or backtick-quoted; or bare). */
export function isQuoted(content: string): boolean {
  if (content.length < 2) return false
  const first = content[0]
  return (first === "'" || first === '"' || first === '`') && content.endsWith(first)
}

/** The escapes a Nushell double-quoted or backtick string processes. */
const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'], ['r', '\r'], ['t', '\t'], ['0', '\0'],
  ['\\', '\\'], ['"', '"'], ["'", "'"], ['`', '`'], ['/', '/'],
])

/**
 * Decode one double-quoted or backtick string body, left to right, so an
 * escaped backslash keeps the character after it literal. Unicode escapes
 * (`\u{61}`, `\u0061`) matter to the guard: Nushell runs `"\u{62}ash"` as bash.
 */
function unescape(inner: string): string {
  let out = ''
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]!
    if (char !== '\\') {
      out += char
      continue
    }
    const next = inner[index + 1]
    if (next === undefined) {
      out += char
      break
    }
    if (next === 'u') {
      const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(inner.slice(index + 2))
      const fixed = braced === null ? /^([0-9a-fA-F]{4})/.exec(inner.slice(index + 2)) : null
      const hex = braced?.[1] ?? fixed?.[1]
      const width = braced !== null ? braced[0].length : fixed !== null ? fixed[0].length : 0
      const codePoint = hex === undefined ? undefined : Number.parseInt(hex, 16)
      if (codePoint !== undefined && codePoint <= 0x10ffff) {
        out += String.fromCodePoint(codePoint)
        index += 1 + width
        continue
      }
    }
    const mapped = ESCAPES.get(next)
    out += mapped ?? char + next
    index += 1
  }
  return out
}

/** A Nu quoted, backtick, or raw string's value, when it is a plain literal. */
export function literalValue(content: string): string | undefined {
  if (isQuoted(content)) {
    const inner = content.slice(1, -1)
    return content.startsWith("'") ? inner : unescape(inner)
  }
  const raw = /^r(#+)(['"])([\s\S]*)\2\1$/.exec(content)
  if (raw !== null) return raw[3]
  return content
}
