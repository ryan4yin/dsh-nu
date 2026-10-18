/**
 * The Nushell-only guard: reject a command that would hand execution to a
 * different shell, before any process exists.
 *
 * This is a scanner, not a parser. It tracks quoting, comments, and raw strings,
 * splits a command into statements and pipeline stages, and answers one question
 * per stage: does this stage start a foreign shell, or a wrapper that launches
 * one?
 */

/** Programs that are a different shell. */
const FOREIGN_SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'mksh', 'ash', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd', 'wsl'])

/** Programs that run another program, so their arguments decide the shell. */
const LAUNCHERS = new Set(['env', 'xargs', 'sudo', 'doas', 'nohup', 'timeout', 'nice', 'stdbuf', 'command', 'exec', 'busybox'])

/** A leading NAME=value token, valid environment syntax in both shells. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** One foreign-shell handoff found in a command. */
export interface ShellHandoff {
  /** The program that would do the work, normalized. */
  shell: string
  /** The statement (pipeline stage) that contains it. */
  statement: string
}

/** Strip a path and a Windows executable suffix, then lower-case. */
function programName(token: string): string {
  const withoutCaret = token.replace(/^\^+/, '')
  const withoutPath = withoutCaret.replace(/\\/g, '/').split('/').pop() ?? withoutCaret
  return withoutPath.toLowerCase().replace(/\.exe$/, '')
}

/** Whether a token names a foreign shell, or starts a string that does. */
function shellIn(token: string): string | undefined {
  const name = programName(token)
  if (FOREIGN_SHELLS.has(name)) return name
  const firstWord = token.trim().split(/\s+/)[0]
  if (firstWord !== undefined && firstWord !== token) {
    const nested = programName(firstWord)
    if (FOREIGN_SHELLS.has(nested)) return nested
  }
  return undefined
}

/** Replace quoted text, raw strings, and comments with spaces, keeping offsets. */
export function codeView(source: string): string {
  let output = ''
  let quote: string | undefined
  let rawEnd: string | undefined
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (rawEnd !== undefined) {
      if (source.startsWith(rawEnd, index)) {
        output += ' '.repeat(rawEnd.length)
        index += rawEnd.length - 1
        rawEnd = undefined
      } else {
        output += char === '\n' ? '\n' : ' '
      }
      continue
    }
    if (quote !== undefined) {
      if (quote === '"' && char === '\\') {
        index += 1
        output += '  '
      } else if (char === quote) {
        quote = undefined
        output += ' '
      } else {
        output += char === '\n' ? '\n' : ' '
      }
      continue
    }
    if (char === 'r' && (source[index + 1] === '#' || source[index + 1] === '"')) {
      const match = /^r(#+)(['"])/.exec(source.slice(index))
      if (match !== null) {
        output += ' '.repeat(match[0].length)
        index += match[0].length - 1
        rawEnd = match[2]! + match[1]!
        continue
      }
    }
    if (char === "'" || char === '"' || char === String.fromCharCode(96)) {
      quote = char
      output += ' '
      continue
    }
    if (char === '#') {
      const newline = source.indexOf('\n', index)
      const end = newline === -1 ? source.length : newline
      output += ' '.repeat(end - index) + (newline === -1 ? '' : '\n')
      index = end
      continue
    }
    output += char
  }
  return output
}

/** Split a command into statements on unquoted semicolons and newlines. */
export function splitStatements(source: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: string | undefined
  let rawEnd: string | undefined
  let comment = false
  const push = (): void => {
    if (current.trim().length > 0) statements.push(current.trim())
    current = ''
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (comment) {
      if (char === '\n') {
        comment = false
        push()
      }
      continue
    }
    if (rawEnd !== undefined) {
      current += char
      if (source.startsWith(rawEnd, index)) {
        current += rawEnd.slice(1)
        index += rawEnd.length - 1
        rawEnd = undefined
      }
      continue
    }
    if (quote !== undefined) {
      current += char
      if (quote === '"' && char === '\\') {
        index += 1
        current += source[index] ?? ''
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === 'r' && (source[index + 1] === '#' || source[index + 1] === '"')) {
      const match = /^r(#+)(['"])/.exec(source.slice(index))
      if (match !== null) {
        current += match[0]
        index += match[0].length - 1
        rawEnd = match[2]! + match[1]!
        continue
      }
    }
    if (char === "'" || char === '"' || char === String.fromCharCode(96)) {
      quote = char
      current += char
      continue
    }
    if (char === '#') {
      comment = true
      continue
    }
    if (char === ';' || char === '\n') {
      push()
      continue
    }
    current += char
  }
  push()
  return statements
}

/** Tokenize one statement, dropping quotes. A pipe is its own token. */
export function tokenize(statement: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | undefined
  let rawEnd: string | undefined
  const flush = (): void => {
    if (current.length > 0) {
      tokens.push(current)
      current = ''
    }
  }
  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index]!
    if (rawEnd !== undefined) {
      if (statement.startsWith(rawEnd, index)) {
        index += rawEnd.length - 1
        rawEnd = undefined
      } else {
        current += char
      }
      continue
    }
    if (quote !== undefined) {
      if (quote === '"' && char === '\\') {
        index += 1
        current += statement[index] ?? ''
      } else if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
      continue
    }
    if (char === 'r' && (statement[index + 1] === '#' || statement[index + 1] === '"')) {
      const match = /^r(#+)(['"])/.exec(statement.slice(index))
      if (match !== null) {
        index += match[0].length - 1
        rawEnd = match[2]! + match[1]!
        continue
      }
    }
    if (char === "'" || char === '"' || char === String.fromCharCode(96)) {
      quote = char
      continue
    }
    if (char === ' ' || char === '\t') {
      flush()
      continue
    }
    if (char === '|') {
      flush()
      tokens.push('|')
      continue
    }
    current += char
  }
  flush()
  return tokens
}

/** Split one statement's tokens into pipeline stages. */
function stages(statement: string): string[][] {
  const result: string[][] = []
  let stage: string[] = []
  for (const token of tokenize(statement)) {
    if (token === '|') {
      if (stage.length > 0) result.push(stage)
      stage = []
    } else {
      stage.push(token)
    }
  }
  if (stage.length > 0) result.push(stage)
  return result
}

/** Find the first foreign-shell handoff in a command. */
export function findHandoff(command: string): ShellHandoff | undefined {
  for (const statement of splitStatements(command)) {
    for (const stage of stages(statement)) {
      let index = 0
      while (index < stage.length && ENV_ASSIGNMENT.test(stage[index]!)) index += 1
      const program = stage[index]
      if (program === undefined) continue
      const direct = shellIn(program)
      if (direct !== undefined) return { shell: direct, statement }
      if (LAUNCHERS.has(programName(program))) {
        for (let scan = index + 1; scan < stage.length; scan += 1) {
          const token = stage[scan]!
          if (token.startsWith('-')) continue
          const launched = shellIn(token)
          if (launched !== undefined) return { shell: launched, statement }
        }
      }
    }
  }
  return undefined
}

/** Compile the allowlist: whole-command regular expressions, validated. */
export function compileAllowlist(raw: unknown): RegExp[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('dsh-nu: foreignShellAllowlist must be an array of regular expressions')
  return raw.map((entry) => {
    if (typeof entry !== 'string') throw new Error('dsh-nu: foreignShellAllowlist entries must be strings')
    try {
      return new RegExp(entry)
    } catch {
      throw new Error('dsh-nu: foreignShellAllowlist entry is not a valid regular expression: ' + JSON.stringify(entry))
    }
  })
}

/** Options for {@link assertNuOnly}. */
export interface NuOnlyOptions {
  allow?: readonly RegExp[]
}

/** Throw when a command would hand execution to another shell. */
export function assertNuOnly(command: string, options: NuOnlyOptions = {}): void {
  if ((options.allow ?? []).some((pattern) => pattern.test(command))) return
  const handoff = findHandoff(command)
  if (handoff === undefined) return
  throw new Error(
    'dsh-nu: refusing to hand this command to ' + handoff.shell + '. This deployment runs every shell command through Nushell only '
    + '(nu --no-config-file -c), so there is no fallback shell. Rewrite the call in Nushell; if that call site is genuinely required, '
    + 'exempt the whole command with foreignShellAllowlist or set enforceNushellOnly: false.\n'
    + 'Offending statement: ' + JSON.stringify(handoff.statement),
  )
}
