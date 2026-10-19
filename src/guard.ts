/**
 * The Nushell-only guard: reject a command that would hand execution to a
 * different shell, before any process exists.
 *
 * The guard reads Nushell's own token stream (`src/ast.ts`), so quoting,
 * comments, raw strings, closures, blocks, and interpolations are already
 * resolved by the parser that will run the command. On top of those tokens it
 * keeps one finite semantic layer:
 *
 * - foreign shell names (bare, path-qualified, or `^`-forced);
 * - a fixed table of programs that launch another program;
 * - `run-external`, because it takes the program as its first argument;
 * - literal `nu -c "..."` scripts, followed recursively (depth 4).
 *
 * It is a guard, not a sandbox: a program that itself starts a shell, a dynamic
 * shell name, or a shell name hidden in data is out of reach.
 */

import { analyze, literalValue } from './ast.js'
import type { AnalyzeOptions, AstToken } from './ast.js'

/** Programs that are a different shell. */
const FOREIGN_SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'mksh', 'ash', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd', 'wsl'])

/** Programs that run another program, so their arguments decide the shell. */
const LAUNCHERS = new Set([
  'env', 'xargs', 'sudo', 'doas', 'nohup', 'timeout', 'nice', 'stdbuf', 'exec', 'busybox',
  'time', 'setsid', 'flock', 'taskset', 'chrt', 'script', 'watch', 'parallel', 'command',
])

/** One foreign-shell handoff found in a command. */
export interface ShellHandoff {
  /** The program that would do the work, normalized. */
  shell: string
  /** The statement (or source slice) that contains it. */
  statement: string
}

/** Options for {@link findHandoff}. */
export interface HandoffOptions extends AnalyzeOptions {}

/** Options for {@link assertNuOnly}. */
export interface NuOnlyOptions extends HandoffOptions {
  allow?: readonly RegExp[]
}

/** How deep a literal `nu -c` script is followed. */
const MAX_DEPTH = 4

/** Literal argument value, or undefined when it is dynamic. */
interface Atom {
  value: string | undefined
  content: string
  flag: boolean
  dynamic: boolean
}

/** Strip a path and a Windows executable suffix, then lower-case. */
function programName(token: string): string {
  const withoutCaret = token.replace(/^\^+/, '')
  const withoutPath = withoutCaret.replace(/\\/g, '/').split('/').pop() ?? withoutCaret
  return withoutPath.toLowerCase().replace(/\.exe$/, '')
}

/** The foreign shell a program name spawns, if any. */
function shellIn(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const name = programName(value)
  return FOREIGN_SHELLS.has(name) ? name : undefined
}

/** Whether an atom is a flag-looking argument. */
function isFlagToken(token: AstToken): boolean {
  if (token.shape === 'shape_flag') return true
  const content = token.content
  return content.startsWith('-') && content.length > 1 && !content.startsWith('->')
}

/** The source text a token covers. */
function sourceOf(command: string, token: AstToken): string {
  if (token.end <= command.length && token.start <= token.end) return command.slice(token.start, token.end)
  return token.content
}

/** A literal atom at `index`, or a dynamic one. */
function readAtom(tokens: readonly AstToken[], command: string, index: number): Atom {
  const token = tokens[index]!
  if (token.shape === 'shape_string_interpolation') {
    const quote = token.content.endsWith('"') ? '"' : "'"
    let value = ''
    let dynamic = false
    let cursor = index + 1
    while (cursor < tokens.length) {
      const inner = tokens[cursor]!
      if (inner.shape === 'shape_string_interpolation' && inner.content === quote) {
        cursor += 1
        break
      }
      if (inner.shape === 'shape_string') {
        value += inner.content
      } else if (inner.shape === 'shape_block' || inner.shape === 'shape_closure') {
        dynamic = true
        break
      } else {
        dynamic = true
      }
      cursor += 1
    }
    return { value: dynamic ? undefined : value, content: token.content, flag: false, dynamic }
  }
  if (token.shape === 'shape_string' || token.shape === 'shape_raw_string' || token.shape === 'shape_externalarg' || token.shape === 'shape_globpattern' || token.shape === 'shape_filepath' || token.shape === 'shape_int') {
    const raw = sourceOf(command, token)
    const value = token.shape === 'shape_int' ? token.content : literalValue(token.content)
    return { value: value ?? raw, content: token.content, flag: isFlagToken(token), dynamic: value === undefined }
  }
  if (token.shape === 'shape_flag') return { value: token.content, content: token.content, flag: true, dynamic: false }
  // Blocks, closures, subexpressions, variables, and anything the parser could
  // not classify are dynamic: the nested commands inside them are still tokens
  // of their own and get scanned separately.
  return { value: undefined, content: token.content, flag: false, dynamic: true }
}

/** The atoms of one command head, stopping at the next command or pipeline. */
function commandAtoms(tokens: readonly AstToken[], command: string, head: number): Atom[] {
  const atoms: Atom[] = []
  let index = head + 1
  while (index < tokens.length) {
    const token = tokens[index]!
    if (
      token.shape === 'shape_pipe' || token.shape === 'shape_operator'
      || token.shape === 'shape_internalcall' || token.shape === 'shape_external'
      || token.shape === 'shape_block' || token.shape === 'shape_closure'
      || token.shape === 'shape_list' || token.shape === 'shape_table' || token.shape === 'shape_record'
      || token.shape === 'shape_signature'
    ) break
    atoms.push(readAtom(tokens, command, index))
    index += 1
  }
  return atoms
}

/** Find a flag value (`-c script`, `-cscript`, `--commands=script`) after `from`. */
function flagValue(atoms: readonly Atom[], from: number, names: readonly string[]): string | undefined {
  for (let index = from; index < atoms.length; index += 1) {
    const atom = atoms[index]!
    for (const name of names) {
      if (atom.content === name) return atoms[index + 1]?.value
      if (atom.content.startsWith(name + '=')) {
        const rhs = atom.content.slice(name.length + 1)
        return literalValue(rhs) ?? rhs
      }
      if (name.startsWith('-') && !name.startsWith('--') && atom.content.startsWith(name) && atom.content.length > name.length) {
        const rhs = atom.content.slice(name.length).replace(/^=/, '')
        return literalValue(rhs) ?? rhs
      }
    }
  }
  return undefined
}

/** Resolve the program a launcher runs, as an index into `atoms`. */
function launcherProgram(name: string, atoms: readonly Atom[]): { value: string; index: number } | undefined {
  const generic = (valueFlags: ReadonlySet<string>, skipPositional = 0): { value: string; index: number } | undefined => {
    let skipped = 0
    let index = 0
    while (index < atoms.length) {
      const atom = atoms[index]!
      if (atom.flag) {
        index += valueFlags.has(atom.content) ? 2 : 1
        continue
      }
      if (atom.dynamic || atom.value === undefined) return undefined
      if (skipped < skipPositional) {
        skipped += 1
        index += 1
        continue
      }
      return { value: atom.value, index }
    }
    return undefined
  }
  switch (name) {
    case 'env': {
      let index = 0
      while (index < atoms.length) {
        const atom = atoms[index]!
        if (atom.flag) {
          if (atom.content === '-S' || atom.content === '--split-string') {
            const value = atoms[index + 1]?.value
            const words = value === undefined ? [] : splitWords(value)
            return firstProgramWord(words)
          }
          const split = atom.content.startsWith('--split-string=')
            ? atom.content.slice('--split-string='.length)
            : atom.content.startsWith('-S') && atom.content.length > 2 ? atom.content.slice(2) : undefined
          if (split !== undefined) return firstProgramWord(splitWords(literalValue(split) ?? split))
          index += ['-u', '--unset', '--chdir', '-C', '-P'].includes(atom.content) ? 2 : 1
          continue
        }
        if (atom.value !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(atom.value)) {
          index += 1
          continue
        }
        return atom.value === undefined ? undefined : { value: atom.value, index }
      }
      return undefined
    }
    case 'timeout':
      return generic(new Set(['-k', '--kill-after', '-s', '--signal']), 1)
    case 'nice':
      return generic(new Set(['-n', '--adjustment']))
    case 'stdbuf':
      return generic(new Set(['-i', '-o', '-e']))
    case 'sudo':
    case 'doas':
      return generic(new Set([
        '-u', '-g', '-p', '-C', '-h', '-T', '-R', '-D', '-U', '-r',
        '--user', '--group', '--prompt', '--chdir', '--host', '--role', '--type',
        '--other-user', '--close-from', '--command-timeout',
      ]))
    case 'xargs':
      return generic(new Set([
        '-n', '-I', '-L', '-P', '-s', '-E', '-d', '-a',
        '--max-args', '--replace', '--max-lines', '--max-procs', '--max-chars',
        '--delimiter', '--arg-file', '--eof', '--process-slot-var',
      ]))
    case 'time':
      return generic(new Set())
    case 'nohup':
    case 'exec':
    case 'setsid':
      return generic(new Set())
    case 'flock': {
      // flock [options] <lockfile> <program> ...
      return generic(new Set(['-w', '--wait', '--timeout', '-E', '--conflict-exit-code', '-o', '--close']), 1)
    }
    case 'taskset': {
      // `taskset -c 0-3 <program>` replaces the bare CPU mask; with a list
      // option there is no positional mask to skip.
      const firstPositional = atoms.findIndex((atom) => !atom.flag)
      const options = firstPositional < 0 ? atoms : atoms.slice(0, firstPositional)
      const hasListOption = options.some((atom) => (
        atom.content === '-c' || atom.content === '--cpu-list'
        || atom.content.startsWith('--cpu-list=') || (atom.content.startsWith('-c') && atom.content.length > 2)
      ))
      return generic(new Set(['-c', '--cpu-list']), hasListOption ? 0 : 1)
    }
    case 'chrt':
      return generic(new Set(['-T', '--sched-runtime', '-P', '--sched-period', '--sched-deadline', '--priority', '--pid']), 1)
    case 'watch':
      return generic(new Set(['-n', '-d', '--interval']))
    case 'parallel':
      return generic(new Set(['-j', '-n', '-L', '-P', '--jobs', '--colsep']))
    case 'busybox': {
      let index = 0
      while (index < atoms.length) {
        if (atoms[index]!.flag) {
          index += 1
          continue
        }
        const value = atoms[index]!.value
        return value === undefined ? undefined : { value, index }
      }
      return undefined
    }
    case 'command': {
      if (atoms.some((atom) => atom.flag && (atom.content === '-v' || atom.content === '-V'))) return undefined
      return generic(new Set())
    }
    case 'script': {
      // `script -c "cmd"` runs cmd through a shell; judge the first word.
      const command = flagValue(atoms, 0, ['-c', '--command'])
      if (command === undefined) return undefined
      return firstProgramWord(splitWords(command))
    }
    default:
      return undefined
  }
}

/** The first non-assignment word of a shell-word list. */
function firstProgramWord(words: readonly string[]): { value: string; index: number } | undefined {
  for (let index = 0; index < words.length; index += 1) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!)) continue
    return { value: words[index]!, index }
  }
  return undefined
}

/** Split a shell-word string (quotes and backslashes honored) into words. */
function splitWords(value: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: string | undefined
  let started = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else if (char === '\\' && quote === '"' && index + 1 < value.length) {
        index += 1
        word += value[index]
      } else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started || word.length > 0) words.push(word)
      word = ''
      started = false
    } else if (char === '\\' && index + 1 < value.length) {
      index += 1
      word += value[index]
      started = true
    } else {
      word += char
      started = true
    }
  }
  if (started || word.length > 0) words.push(word)
  return words
}

/** The `env -S` / `--split-string` words, when one is present. */
function envSplitWords(atoms: readonly Atom[]): string[] | undefined {
  for (const atom of atoms) {
    if (atom.content === '-S' || atom.content === '--split-string') continue
    if (atom.content.startsWith('--split-string=')) {
      const value = atom.content.slice('--split-string='.length)
      return splitWords(literalValue(value) ?? value)
    }
    if (atom.content.startsWith('-S') && atom.content.length > 2) {
      const value = atom.content.slice(2)
      return splitWords(literalValue(value) ?? value)
    }
  }
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index]!
    if (atom.content === '-S' || atom.content === '--split-string') {
      const value = atoms[index + 1]?.value
      if (value === undefined) return undefined
      return splitWords(value)
    }
  }
  return undefined
}

/** Turn shell words into launcher atoms; quotes are already gone. */
function wordsToAtoms(words: readonly string[]): Atom[] {
  return words.map((word) => ({
    value: word,
    content: word,
    flag: word.startsWith('-') && word.length > 1 && !word.startsWith('->'),
    dynamic: false,
  }))
}

/** Follow an `env -S` word list through env options to its program. */
async function handoffFromWords(
  words: readonly string[],
  depth: number,
  command: string,
  options: HandoffOptions,
): Promise<ShellHandoff | undefined> {
  if (depth > MAX_DEPTH) return undefined
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || word === '--') {
      index += 1
      continue
    }
    if (word === '-S' || word === '--split-string') {
      const value = words[index + 1]
      return value === undefined ? undefined : handoffFromWords(splitWords(value), depth + 1, command, options)
    }
    if (word.startsWith('--split-string=')) {
      const value = word.slice('--split-string='.length)
      return handoffFromWords(splitWords(literalValue(value) ?? value), depth + 1, command, options)
    }
    if (word.startsWith('-S') && word.length > 2) {
      const value = word.slice(2)
      return handoffFromWords(splitWords(literalValue(value) ?? value), depth + 1, command, options)
    }
    if (['-u', '--unset', '--chdir', '-C', '-P'].includes(word)) {
      index += 2
      continue
    }
    if (word.startsWith('-')) {
      index += 1
      continue
    }
    const shell = shellIn(word)
    if (shell !== undefined) return { shell, statement: command.trim().slice(0, 400) }
    const name = programName(word)
    const rest = wordsToAtoms(words.slice(index + 1))
    if (LAUNCHERS.has(name)) return handoffFromLauncher(name, rest, depth, command, options)
    if (name === 'nu') {
      const script = flagValue(rest, 0, ['-c', '--commands'])
      if (script !== undefined) {
        const nested = await findHandoffIn(script, depth + 1, options)
        if (nested !== undefined) return { shell: nested.shell, statement: script.trim().slice(0, 400) }
      }
    }
    return undefined
  }
  return undefined
}

/** Whether a token is at a command position (not inside a string). */
function isExternalHead(token: AstToken): boolean {
  return token.shape === 'shape_external'
}

/** Find the first foreign-shell handoff in a command. */
async function findHandoffIn(command: string, depth: number, options: HandoffOptions): Promise<ShellHandoff | undefined> {
  if (depth > MAX_DEPTH) return undefined
  const analysis = await analyze(command, options)
  const { tokens } = analysis
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const atom = readAtom(tokens, command, index)
    if (isExternalHead(token)) {
      const shell = shellIn(atom.value ?? token.content)
      if (shell !== undefined) return { shell, statement: command.trim().slice(0, 400) }
      const direct = programName(token.content)
      const atoms = commandAtoms(tokens, command, index)
      const handled = await handoffFromLauncher(direct, atoms, depth, command, options)
      if (handled !== undefined) return handled
      if (direct === 'nu' || direct === 'nu.exe') {
        const script = flagValue(atoms, 0, ['-c', '--commands'])
        if (script !== undefined) {
          const nested = await findHandoffIn(script, depth + 1, options)
          if (nested !== undefined) return { shell: nested.shell, statement: script.trim().slice(0, 400) }
        }
      }
    } else if (token.shape === 'shape_internalcall') {
      const name = token.content.toLowerCase()
      if (name === 'run-external') {
        const atoms = commandAtoms(tokens, command, index)
        let program: { value: string; index: number } | undefined
        for (let cursor = 0; cursor < atoms.length; cursor += 1) {
          const candidate = atoms[cursor]!
          if (candidate.flag || candidate.content === '--') continue
          if (candidate.value === undefined) break
          program = { value: candidate.value, index: cursor }
          break
        }
        if (program !== undefined) {
          const shell = shellIn(program.value)
          if (shell !== undefined) return { shell, statement: command.trim().slice(0, 400) }
          const programNameValue = programName(program.value)
          if (LAUNCHERS.has(programNameValue)) {
            const handled = await handoffFromLauncher(programNameValue, atoms.slice(program.index + 1), depth, command, options)
            if (handled !== undefined) return handled
          }
          if (programNameValue === 'nu') {
            const script = flagValue(atoms, program.index + 1, ['-c', '--commands'])
            if (script !== undefined) {
              const nested = await findHandoffIn(script, depth + 1, options)
              if (nested !== undefined) return { shell: nested.shell, statement: script.trim().slice(0, 400) }
            }
          }
        }
      } else if (name === 'exec') {
        // Nu's `exec` replaces the process with another program; it is a
        // launcher even though the parser classifies it as an internal call.
        const atoms = commandAtoms(tokens, command, index)
        const handled = await handoffFromLauncher('exec', atoms, depth, command, options)
        if (handled !== undefined) return handled
      }
    }
  }
  return undefined
}

/** Follow a launcher chain (`env timeout 5 bash`) to its program. */
async function handoffFromLauncher(
  name: string,
  atoms: readonly Atom[],
  depth: number,
  command: string,
  options: HandoffOptions,
): Promise<ShellHandoff | undefined> {
  let current = name
  let remaining = atoms
  for (let hop = 0; hop < 4; hop += 1) {
    if (!LAUNCHERS.has(current)) return undefined
    if (current === 'env') {
      const words = envSplitWords(remaining)
      if (words !== undefined) return handoffFromWords(words, depth, command, options)
    }
    if (current === 'script' && flagValue(remaining, 0, ['-c', '--command']) !== undefined) {
      // `script -c` runs the command through a POSIX shell.
      return { shell: 'sh', statement: command.trim().slice(0, 400) }
    }
    if (current === 'flock') {
      // Only flock's own options precede the lockfile; a later `-c` belongs to
      // the launched program. `flock -c` hands the command string to a shell.
      const firstPositional = remaining.findIndex((atom) => !atom.flag)
      const options = firstPositional < 0 ? remaining : remaining.slice(0, firstPositional)
      const hasCommand = options.some((atom) => atom.content === '-c' || atom.content === '--command'
        || (atom.content.startsWith('-c') && atom.content.length > 2) || atom.content.startsWith('--command='))
      if (hasCommand) return { shell: 'sh', statement: command.trim().slice(0, 400) }
    }
    const program = launcherProgram(current, remaining)
    if (program === undefined) return undefined
    const shell = shellIn(program.value)
    if (shell !== undefined) return { shell, statement: command.trim().slice(0, 400) }
    if (programName(program.value) === 'nu') {
      const script = flagValue(remaining, program.index + 1, ['-c', '--commands'])
      if (script !== undefined) {
        const nested = await findHandoffIn(script, depth + 1, options)
        if (nested !== undefined) return { shell: nested.shell, statement: script.trim().slice(0, 400) }
      }
      return undefined
    }
    const next = programName(program.value)
    if (!LAUNCHERS.has(next)) return undefined
    current = next
    remaining = remaining.slice(program.index + 1)
  }
  return undefined
}

/** Find the first foreign-shell handoff in a command. */
export function findHandoff(command: string, options: HandoffOptions = {}): Promise<ShellHandoff | undefined> {
  return findHandoffIn(command, 0, options)
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

/** Throw when a command would hand execution to another shell. */
export async function assertNuOnly(command: string, options: NuOnlyOptions = {}): Promise<void> {
  if ((options.allow ?? []).some((pattern) => pattern.test(command))) return
  const handoff = await findHandoff(command, options)
  if (handoff === undefined) return
  throw new Error(
    'dsh-nu: refusing to hand this command to ' + handoff.shell + '. This deployment runs every shell command through Nushell only '
    + '(nu --no-config-file -c), so there is no fallback shell. Rewrite the call in Nushell; if that call site is genuinely required, '
    + 'exempt the whole command with foreignShellAllowlist or set enforceNushellOnly: false.\n'
    + 'Offending statement: ' + JSON.stringify(handoff.statement),
  )
}
