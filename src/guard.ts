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
const LAUNCHERS = new Set(['env', 'xargs', 'sudo', 'doas', 'nohup', 'timeout', 'nice', 'stdbuf', 'exec', 'busybox', 'time', 'setsid', 'flock', 'taskset', 'chrt', 'script', 'watch', 'parallel'])

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

/** A comment starts only at a token boundary; `a#b` is one bare word. */
function commentStart(source: string, index: number): boolean {
  if (index === 0) return true
  return /[\s;|([{,]/.test(source[index - 1] ?? '')
}

/** Index just past a quoted string that starts at `index`. */
function skipQuoted(source: string, index: number): number {
  const quote = source[index]!
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (char === '\\') {
      cursor += 1
      continue
    }
    if (char === quote) return cursor + 1
  }
  return source.length
}

/** Index just past an interpolated string whose opening quote is at `index`. */
function skipInterpolated(source: string, index: number): number {
  const quote = source[index]!
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (char === '\\') {
      cursor += 1
      continue
    }
    if (char === '$' && (source[cursor + 1] === '"' || source[cursor + 1] === "'")) {
      cursor = skipInterpolated(source, cursor + 1) - 1
      continue
    }
    if (char === quote) return cursor + 1
  }
  return source.length
}

/** Index just past a raw string (`r#'…'#`) that starts at `index`, or -1. */
function skipRaw(source: string, index: number): number {
  const match = /^r(#+)(['"])/.exec(source.slice(index))
  if (match === null) return -1
  const closing = match[2]! + match[1]!
  const end = source.indexOf(closing, index + match[0].length)
  return end === -1 ? source.length : end + closing.length
}

/** Index of the `)` matching the `(` at `open`, skipping quoted text. */
function matchingParen(source: string, open: number): number | undefined {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '#' && commentStart(source, index)) {
      const newline = source.indexOf('\n', index)
      if (newline === -1) return undefined
      index = newline
      continue
    }
    const raw = char === 'r' ? skipRaw(source, index) : -1
    if (raw !== -1) {
      index = raw - 1
      continue
    }
    if (char === '$' && (source[index + 1] === '"' || source[index + 1] === "'")) {
      index = skipInterpolated(source, index + 1) - 1
      continue
    }
    if (char === '"' || char === "'" || char === String.fromCharCode(96)) {
      index = skipQuoted(source, index) - 1
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return undefined
}

/**
 * Subexpressions inside an interpolated string (`$"sum (1 + 2)"`, `$'…'`).
 * Their parentheses are code, so a shell call or redirect inside one runs even
 * though the surrounding text is a string.
 */
export function interpolationExpressions(source: string): string[] {
  const expressions: string[] = []
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '#' && commentStart(source, index)) {
      const newline = source.indexOf('\n', index)
      if (newline === -1) break
      index = newline
      continue
    }
    const raw = char === 'r' ? skipRaw(source, index) : -1
    if (raw !== -1) {
      index = raw - 1
      continue
    }
    if (char === '$' && (source[index + 1] === '"' || source[index + 1] === "'")) {
      const closing = skipInterpolated(source, index + 1)
      const body = source.slice(index + 2, closing - 1)
      for (let cursor = 0; cursor < body.length; cursor += 1) {
        const bodyChar = body[cursor]
        if (bodyChar === '\\') {
          cursor += 1
          continue
        }
        if (bodyChar === '$' && (body[cursor + 1] === '"' || body[cursor + 1] === "'")) {
          cursor = skipInterpolated(body, cursor + 1) - 1
          continue
        }
        if (bodyChar === '"' || bodyChar === "'" || bodyChar === String.fromCharCode(96)) {
          cursor = skipQuoted(body, cursor) - 1
          continue
        }
        if (bodyChar !== '(') continue
        const end = matchingParen(body, cursor)
        if (end === undefined) break
        expressions.push(body.slice(cursor + 1, end))
        cursor = end
      }
      index = closing - 1
      continue
    }
    if (char === '"' || char === "'" || char === String.fromCharCode(96)) {
      index = skipQuoted(source, index) - 1
      continue
    }
  }
  return expressions
}

/** Names that statement-level `def` / `alias` declarations define. */
function definedNames(statements: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>()
  for (const statement of statements) {
    const tokens = tokenize(statement)
    let index = 0
    if (tokens[index]?.toLowerCase() === 'export') index += 1
    const keyword = tokens[index]?.toLowerCase()
    if (keyword !== 'def' && keyword !== 'alias') continue
    index += 1
    while (tokens[index]?.startsWith('-') === true) index += 1
    const name = tokens[index]
    if (name !== undefined) names.add(programName(name))
  }
  return names
}

/**
 * Whether the `|` at this offset opens a closure parameter list, such as
 * `{ |sh| … }` or `{ |sh, ...rest| … }`, rather than separating pipeline
 * stages. A parameter may be named `sh`, `cmd`, or `bash`, and that
 * declaration is not a handoff.
 */
function opensClosureParams(command: string, index: number): boolean {
  let back = index - 1
  while (back >= 0 && /\s/.test(command[back] ?? '')) back -= 1
  if (back < 0 || command[back] !== '{') return false
  const parameter = /^(\s*)(?:(?:\.\.\.|\$)?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*,\s*(?:\.\.\.|\$)?[A-Za-z_][A-Za-z0-9_-]*)*\s*\|/
  return parameter.test(command.slice(index + 1))
}

/** Characters that end a bare word, so they cannot appear in a program token. */
const WORD_END = /[\s;|&(){}]/

/** One bare word in the blanked view. */
interface Word {
  text: string
  start: number
  end: number
}

/** Read the next bare word at or after an offset, skipping whitespace. */
function nextWord(view: string, start: number): Word | undefined {
  let index = start
  while (index < view.length && /\s/.test(view[index] ?? '')) index += 1
  if (index >= view.length) return undefined
  const begin = index
  while (index < view.length && !WORD_END.test(view[index] ?? '')) index += 1
  return index === begin ? undefined : { text: view.slice(begin, index), start: begin, end: index }
}

/** The next non-whitespace character at or after an offset. */
function nextChar(view: string, start: number): string | undefined {
  let index = start
  while (index < view.length && /\s/.test(view[index] ?? '')) index += 1
  return view[index]
}

/** The first program position after a delimiter, if it hands off to a shell. */
function handoffAfter(view: string, start: number, statement: string, defined: ReadonlySet<string>): ShellHandoff | undefined {
  let word = nextWord(view, start)
  while (word !== undefined && ENV_ASSIGNMENT.test(word.text)) word = nextWord(view, word.end)
  if (word === undefined) return undefined
  // A record key or match arm, not a command: `{ sh: 1 }`, `{ bash => 1 }`.
  const following = nextChar(view, word.end)
  if (following === ':' || following === '=') return undefined
  const name = programName(word.text)
  if (FOREIGN_SHELLS.has(name)) {
    if (defined.has(name) && !word.text.startsWith('^')) return undefined
    return { shell: name, statement }
  }
  if (!LAUNCHERS.has(name)) return undefined
  for (let argument = nextWord(view, word.end); argument !== undefined; argument = nextWord(view, argument.end)) {
    if (argument.text.startsWith('-') || ENV_ASSIGNMENT.test(argument.text)) continue
    const launched = programName(argument.text)
    if (FOREIGN_SHELLS.has(launched)) return { shell: launched, statement }
  }
  return undefined
}

/**
 * Find a foreign-shell handoff at a command position nested in a block or a
 * subexpression, where the statement-level scan only sees the block's head:
 * `do { /bin/sh -c … }`, `do { env bash … }`, `do { FOO=1 bash … }`. Strings
 * and comments are blanked first, record keys, match arms, and defined names
 * are skipped, and a closure parameter list is a declaration rather than a
 * command position.
 */
function findNestedHandoff(command: string, view: string, defined: ReadonlySet<string>): ShellHandoff | undefined {
  const statement = command.trim().slice(0, 400)
  let square = 0
  for (let index = 0; index < view.length; index += 1) {
    const char = view[index]
    // Inside a list literal a newline separates values, not commands.
    if (char === '[') { square += 1; continue }
    if (char === ']') { square = Math.max(0, square - 1); continue }
    if (char !== '(' && char !== '{' && char !== ';' && char !== '\n' && char !== '|' && char !== '&') continue
    if (char === '\n' && square > 0) continue
    if (char === '|' && opensClosureParams(command, index)) continue
    // `&` is a bare-word character (print a&sh is one word) and separates only when it stands alone.
    if (char === '&' && index > 0 && !/\s/.test(view[index - 1] ?? '')) continue
    const handoff = handoffAfter(view, index + 1, statement, defined)
    if (handoff !== undefined) return handoff
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
    if (char === '#' && commentStart(source, index)) {
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

/**
 * Split a command into statements on unquoted semicolons and newlines at
 * bracket depth zero; a newline inside a list, record, or block does not start
 * a statement (it is whitespace between tokens).
 */
export function splitStatements(source: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: string | undefined
  let rawEnd: string | undefined
  let comment = false
  let depth = 0
  const push = (): void => {
    if (current.trim().length > 0) statements.push(current.trim())
    current = ''
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (comment) {
      if (char === '\n') {
        comment = false
        if (depth === 0) push()
        else current += '\n'
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
    if (char === '#' && commentStart(source, index)) {
      comment = true
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1)
    if ((char === ';' || char === '\n') && depth === 0) {
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
    if (/\s/.test(char)) {
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

/**
 * Split one statement's tokens into pipeline stages, keeping a closure
 * parameter list (`{ |sh| … }`) out of the stages: those bars declare names,
 * they do not separate commands.
 */
function stages(statement: string): string[][] {
  const result: string[][] = []
  let stage: string[] = []
  let params = false
  let previous: string | undefined
  for (const token of tokenize(statement)) {
    if (params) {
      if (token === '|') params = false
      previous = token
      continue
    }
    if (token === '|' && previous === '{') {
      params = true
      previous = token
      continue
    }
    if (token === '|') {
      if (stage.length > 0) result.push(stage)
      stage = []
    } else {
      stage.push(token)
    }
    previous = token
  }
  if (stage.length > 0) result.push(stage)
  return result
}

/** Interpolation nesting this scan follows before giving up. */
const MAX_INTERPOLATION_DEPTH = 8

/** Find the first foreign-shell handoff in a command. */
function findHandoffIn(command: string, depth: number): ShellHandoff | undefined {
  const view = codeView(command)
  const statements = splitStatements(command)
  const defined = definedNames(statements)
  for (const statement of statements) {
    for (const stage of stages(statement)) {
      let index = 0
      while (index < stage.length && ENV_ASSIGNMENT.test(stage[index]!)) index += 1
      const program = stage[index]
      if (program === undefined) continue
      const direct = shellIn(program)
      // `^name` forces the external program even when the shell defines a name.
      if (direct !== undefined && (program.startsWith('^') || !defined.has(direct))) {
        return { shell: direct, statement }
      }
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
  const nested = findNestedHandoff(command, view, defined)
  if (nested !== undefined) return nested
  if (depth >= MAX_INTERPOLATION_DEPTH) return undefined
  for (const expression of interpolationExpressions(command)) {
    const handoff = findHandoffIn(expression, depth + 1)
    if (handoff !== undefined) return { shell: handoff.shell, statement: command.trim().slice(0, 400) }
  }
  return undefined
}

/** Find the first foreign-shell handoff in a command. */
export function findHandoff(command: string): ShellHandoff | undefined {
  return findHandoffIn(command, 0)
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
