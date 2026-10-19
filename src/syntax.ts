/**
 * Nushell syntax preflight and failure hints.
 *
 * Nushell does not translate bash or PowerShell syntax: some forms fail at
 * parse time, some at run time, and some quietly do the wrong thing (a plain
 * greater-than is a comparison; a numbered stderr redirect is an argument).
 * The preflight refuses the loudly failing and the silently wrong forms before
 * a process is spawned; the hints explain a failure Nushell actually reported.
 *
 * The preflight asks Nushell's own parser (`nu --ide-ast`) and its diagnostics
 * (`nu --ide-check`) instead of scanning the command with a second lexer:
 * quoting, comments, nested blocks, and string interpolation are classified by
 * the grammar that will run the command. It is tuned to the tested Nushell
 * version and tested differentially against it.
 */

import {
  analyze,
  isQuoted,
  literalValue,
  type Analysis,
  type AnalyzeOptions,
  type AstDiagnostic,
  type AstToken,
} from './ast.js'
import { isAllowlisted } from './guard.js'

/** A refused syntax form. */
export type RuleId =
  | 'stderr-redirect'
  | 'stderr-file'
  | 'stderr-as-word'
  | 'stdout-redirect'
  | 'stdin-redirect'
  | 'powershell-env'
  | 'bare-assignment'
  | 'foreach-loop'
  | 'powershell-cmdlet'
  | 'and-or'
  | 'command-substitution'
  | 'exit-status'
  | 'bash-flag'
  | 'comma-column'
  | 'array-literal'
  | 'export-assignment'
  | 'current-item'
  | 'powershell-not'
  | 'deprecated-flags'
  | 'powershell-parameter'
  | 'negative-count'
  | 'percent-sigil'
  | 'pipe-redirect'
  | 'glob-named-arguments'

/** One refused syntax form and the shape that replaces it. */
export interface Finding {
  id: RuleId
  fragment: string
  fix: string
}

/** Options for the syntax preflight. */
export interface SyntaxOptions extends AnalyzeOptions {
  allow?: readonly RegExp[]
}

/** The replacement guidance for each rule. */
const FIXES: Readonly<Record<RuleId, string>> = {
  'stderr-redirect': 'Nushell has no 2>&1. Redirect with o+e> out.txt, or capture both streams with (do { cmd } | complete).',
  // `2> target` with a space is a Nushell parse error; every other numbered
  // redirect spelling is lexed as a word and runs.
  'stderr-as-word': 'Nushell reads 2>... as an ordinary argument: the command runs, stderr is not redirected, and nothing fails. Drop stderr with e>| ignore, send it with e> err.txt, keep both streams with o+e> all.txt, or capture both with (do { cmd } | complete).',
  'stderr-file': '2> is a shell redirection, and Nushell rejects it. Send stderr with e> err.txt, stdout with o> out.txt, both with o+e> out.txt.',
  // Comparisons are shape_operator tokens and never reach the token rule, so
  // any word starting with > is a shell redirect in argument position.
  'stdout-redirect': 'In Nushell a bare > is comparison, not a redirect: cmd > out.txt would pass > and the filename as arguments, exit 0, and write no file. The preflight refuses that spelling. Redirect stdout with o> out.txt, append with o>> out.txt, keep both streams with o+e> out.txt, or pipe into save -f out.txt.',
  // `<` has no input-redirection form in Nushell either; `<<` / `<<<` (a
  // heredoc or here-string) are operators Nushell does not know. Comparisons
  // such as `where size < 1kb` are operator tokens and stay valid.
  'stdin-redirect': 'Nushell has no < file input redirection, and no << / <<< operator: cmd < in.txt would pass < and the filename as arguments, so the preflight refuses it. Feed the file into the command instead, for example ^prog (open --raw in.txt), or pass the path as an argument.',
  'powershell-env': 'PowerShell writes $env:NAME; Nushell writes $env.NAME (optional read: $env.NAME?).',
  'bare-assignment': 'Nushell has no bare $x = assignment: bind with let x = ... (immutable) or mut x = ... (reassignable); the environment is $env.x = ....',
  'foreach-loop': 'Nushell loops are for item in $items { ... }; transform a list with ... | each { |item| ... }.',
  'powershell-cmdlet': 'PowerShell cmdlets have one-word Nushell equivalents: Get-ChildItem -> ls, Get-Content -> open --raw, Select-Object -> select or first, Where-Object -> where.',
  'and-or': 'Nushell has no && or ||. Separate commands with a semicolon (a failing external aborts the rest), or branch with if / and / or.',
  'command-substitution': 'Nushell substitutes with (command) for a value; use a subexpression where the value is needed.',
  'exit-status': 'Nushell has no $?. Read (do { cmd } | complete).exit_code, or $env.LAST_EXIT_CODE? after an external command.',
  'bash-flag': 'Unknown Nushell flags: mkdir a/b (parents are automatic), ls --all --long. External tools keep their own flags, but Nushell builtins do not accept bash ones.',
  'comma-column': 'Nushell has no comma-separated columns: select name size. Lists are [1, 2], but command arguments are space-separated.',
  'array-literal': 'Nushell lists are [1 2 3]; PowerShell @(...) is not an array literal.',
  'export-assignment': 'Nushell has no export NAME=. Set an environment value with $env.NAME = ...; module exports use export def / export const.',
  'current-item': 'PowerShell uses $_. Nushell closures name their item: ls | each { |item| $item.name }.',
  'powershell-not': 'Nushell negates with not or by comparing: if not ($x == 1) { ... } or if $x != 1 { ... }.',
  'deprecated-flags': 'PowerShell verbs are not Nushell flags: use first 20, last 20, uniq, or sort-by.',
  'powershell-parameter': 'PowerShell common parameters do not exist here: drop -ErrorAction / -Force / -Recurse and use Nushell flags or ignore errors with do -i.',
  'negative-count': 'Counts are positive: first 3, last 40. Negative counts are not supported.',
  'percent-sigil': 'Nushell has no %{ ... } block. Use do { ... }, each { ... }, or a named closure.',
  'pipe-redirect': 'A redirection must end the command that produces the value. Pipe into save -f file instead of | o> file.',
  // A pattern may contain `=`, so only the named-argument keys are refused.
  'glob-named-arguments': 'glob takes one pattern and an optional --depth, not named pattern=/path= arguments: glob "**/*.rs".',
}

/** All rule ids in detection order; the earliest rule wins. */
const RULE_ORDER: readonly RuleId[] = [
  'stderr-redirect',
  'stderr-as-word',
  'stderr-file',
  'stdout-redirect',
  'stdin-redirect',
  'powershell-env',
  'bare-assignment',
  'foreach-loop',
  'powershell-cmdlet',
  'and-or',
  'command-substitution',
  'exit-status',
  'bash-flag',
  'comma-column',
  'array-literal',
  'export-assignment',
  'current-item',
  'powershell-not',
  'deprecated-flags',
  'powershell-parameter',
  'negative-count',
  'percent-sigil',
  'pipe-redirect',
  'glob-named-arguments',
]

/** All refusal rule ids, in rule order. */
export const RULE_IDS: readonly string[] = RULE_ORDER

const PRIORITY: ReadonlyMap<RuleId, number> = new Map(RULE_ORDER.map((id, index) => [id, index]))

/** A candidate refusal before its fix text is attached. */
interface Candidate {
  id: RuleId
  fragment: string
  start: number
}

/** A trimmed source slice, clamped to the command. */
function fragmentOf(command: string, start: number, end: number): string {
  const from = Math.max(0, Math.min(start, command.length))
  const to = Math.max(from, Math.min(end, command.length))
  return command.slice(from, to).trim()
}

/** Build a finding candidate for a source span. */
function candidateFromSpan(id: RuleId, command: string, start: number, end: number): Candidate {
  return { id, fragment: fragmentOf(command, start, end), start }
}

/** Token shapes that carry a plain word argument. */
const WORD_SHAPES: ReadonlySet<string> = new Set(['shape_string', 'shape_externalarg', 'shape_globpattern'])

/** Whether a token is literal data rather than syntax (quoted, raw, interpolated). */
function isData(content: string): boolean {
  return isQuoted(content) || content.startsWith('r#') || content.startsWith('$"') || content.startsWith("$'")
}

/** A word token's unquoted value, or undefined when the token is data. */
function wordContent(token: AstToken): string | undefined {
  if (!WORD_SHAPES.has(token.shape) || isData(token.content)) return undefined
  return literalValue(token.content)
}

/**
 * The refused shell redirect a token spells, when it is one: any bare
 * `>`/`>>`/`<` word, plus the numbered and merged stderr spellings Nushell
 * accepts as ordinary arguments. Comparisons are `shape_operator` tokens and
 * never reach this function, so a word token beginning with `>` or `<` is a
 * shell redirect the author meant.
 */
function redirectFinding(command: string, tokens: readonly AstToken[], index: number): Candidate | undefined {
  const token = tokens[index]!
  const content = wordContent(token)
  if (content === undefined) return undefined

  // Numbered and merged stderr spellings: Nushell reads them as arguments.
  if (/^\d+>>/.test(content)) return candidateFromSpan('stderr-as-word', command, token.start, token.end)
  if (/^\d+>&\d/.test(content)) return candidateFromSpan('stderr-redirect', command, token.start, token.end)
  if (/^\d+>&(?!\d)/.test(content)) return candidateFromSpan('stderr-as-word', command, token.start, token.end)
  if (/^>&\d/.test(content)) return candidateFromSpan('stderr-redirect', command, token.start, token.end)
  if (content.startsWith('>&')) return candidateFromSpan('stderr-as-word', command, token.start, token.end)
  if (content.startsWith('&>')) return candidateFromSpan('stderr-as-word', command, token.start, token.end)
  if (/^\d+>/.test(content)) {
    // `1>` alone is the classic bash spelling. A bare `2>` with a space is a
    // parser error that --ide-check reports as stderr-file.
    if (content === '1>' || content.length > 2) return candidateFromSpan('stderr-as-word', command, token.start, token.end)
    return undefined
  }

  // Any remaining word that starts with > / < is a shell redirect in argument
  // position. Quoted strings and operators are data and were skipped above.
  if (content.startsWith('>')) return candidateFromSpan('stdout-redirect', command, token.start, token.end)
  // A whole `<tag>` word is not a redirect in bash either, so it is data.
  if (content.startsWith('<') && !/^<[^<>]+>$/.test(content)) return candidateFromSpan('stdin-redirect', command, token.start, token.end)
  return undefined
}

/** Commands whose comma spelling is a PowerShell column list. */
const COLUMN_COMMANDS: ReadonlySet<string> = new Set(['select', 'sort-by', 'where'])

/** Commands whose negative count argument is not a Nushell count. */
const COUNT_COMMANDS: ReadonlySet<string> = new Set(['first', 'last', 'skip', 'take', 'drop'])

/** Whether the gap between two tokens ends the statement or the stage. */
function endsStage(gap: string): boolean {
  return /[;|\n]/.test(gap)
}

/** PowerShell cmdlet names, which run as external commands here. */
const POWERSHELL_CMDLET =
  /^(?:Get|Set|Remove|Copy|Move|Test|Join|Select|Where|ForEach|New|Invoke|Write|Add|Clear|Out|Start|Stop|Sort|Group|Measure|ConvertTo|ConvertFrom|Rename|Split|Format|Import|Export|Read|Update)-[A-Za-z]+$/

/**
 * Mark word tokens that are literal text inside an interpolated string.
 * `$'…'` and `$"…"` are data except for each parenthesized expression, which
 * the parser exposes as code between `(` and `)` block tokens; a redirect that
 * merely appears in the literal text is not syntax.
 */
function literalTextTokens(tokens: readonly AstToken[]): boolean[] {
  const literal: boolean[] = tokens.map(() => false)
  const parenDepth: number[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.shape === 'shape_string_interpolation') {
      if (token.content === '$"' || token.content === "$'") parenDepth.push(0)
      else if (parenDepth.length > 0) parenDepth.pop()
      continue
    }
    if (token.shape === 'shape_block' && parenDepth.length > 0) {
      const top = parenDepth.length - 1
      const opens = (token.content.match(/\(/g) ?? []).length
      const closes = (token.content.match(/\)/g) ?? []).length
      parenDepth[top] = Math.max(0, (parenDepth[top] ?? 0) + opens - closes)
      continue
    }
    if (parenDepth.length > 0 && parenDepth[parenDepth.length - 1] === 0) literal[index] = true
  }
  return literal
}

/** The refusals Nushell's parser accepts silently but that are shell syntax. */
function tokenFindings(analysis: Analysis): Candidate[] {
  const { command, tokens } = analysis
  const literal = literalTextTokens(tokens)
  const findings: Candidate[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (literal[index] === true) continue
    const token = tokens[index]!
    if (token.shape === 'shape_external') {
      if (token.content === 'foreach') {
        findings.push(candidateFromSpan('foreach-loop', command, token.start, token.end))
      } else if (command[token.start - 1] !== '^' && POWERSHELL_CMDLET.test(token.content)) {
        // A leading caret forces the external binary, which keeps cmdlet-shaped
        // programs usable.
        findings.push(candidateFromSpan('powershell-cmdlet', command, token.start, token.end))
      }
    } else if (token.shape === 'shape_internalcall') {
      if (COLUMN_COMMANDS.has(token.content)) {
        for (let next = index + 1; next < tokens.length; next += 1) {
          const argument = tokens[next]!
          if (argument.shape === 'shape_pipe' || endsStage(command.slice(tokens[next - 1]!.end, argument.start))) break
          if (argument.shape === 'shape_string' && !isData(argument.content) && argument.content.endsWith(',')) {
            findings.push(candidateFromSpan('comma-column', command, argument.start, argument.end))
            break
          }
        }
      } else if (COUNT_COMMANDS.has(token.content)) {
        const count = tokens[index + 1]
        if (count !== undefined && count.shape === 'shape_int' && count.content.startsWith('-')) {
          findings.push(candidateFromSpan('negative-count', command, count.start, count.end))
        }
      } else if (token.content === 'glob') {
        const pattern = tokens[index + 1]
        if (
          pattern !== undefined &&
          pattern.shape === 'shape_string' &&
          !isData(pattern.content) &&
          /^(?:pattern|path|filter|depth)=/.test(pattern.content)
        ) {
          findings.push(candidateFromSpan('glob-named-arguments', command, pattern.start, pattern.end))
        }
      }
    }
    const redirect = redirectFinding(command, tokens, index)
    if (redirect !== undefined) findings.push(redirect)
  }
  return findings
}

/** `2>&1` and similar shell operations that Nushell reports by name. */
function shellOperationFinding(command: string, diagnostic: AstDiagnostic): Candidate | undefined {
  const message = diagnostic.message
  if (message.includes("shell operation is 'out+err>'")) {
    return candidateFromSpan('stderr-redirect', command, diagnostic.start, diagnostic.end)
  }
  if (message.includes("shell operation is 'err>'")) {
    return candidateFromSpan('stderr-file', command, diagnostic.start, diagnostic.end)
  }
  return undefined
}

/** Classify an unresolved `$name` span Nushell reported as a variable error. */
function variableFinding(command: string, diagnostic: AstDiagnostic): Candidate | undefined {
  const slice = command.slice(diagnostic.start, diagnostic.end)
  if (slice.startsWith('$env:')) return candidateFromSpan('powershell-env', command, diagnostic.start, diagnostic.end)
  if (slice.startsWith('$_') || slice.startsWith('$PSItem')) {
    return candidateFromSpan('current-item', command, diagnostic.start, diagnostic.end)
  }
  let cursor = diagnostic.end
  while (cursor < command.length && /\s/.test(command[cursor]!)) cursor += 1
  // `$x =` assigns without let/mut; `$x ==`, `$x =~`, and `$x =>` do not.
  if (command[cursor] === '=') {
    const after = command[cursor + 1]
    if (after !== '=' && after !== '~' && after !== '>') {
      return candidateFromSpan('bare-assignment', command, diagnostic.start, cursor + 1)
    }
  }
  return undefined
}

const FLAG_MESSAGE = /^The `([^`]+)` command doesn't have flag `([^`]*)`\.$/
const DEPRECATED_FLAGS = /^-(?:First|Last|Unique|Skip|Descending|Ascending)$/i
const POWERSHELL_PARAMETERS = /^-(?:ErrorAction|Force|Recurse)$/i
const DEPRECATED_COMMANDS: ReadonlySet<string> = new Set(['select', 'sort-by', 'sort', 'measure', 'group-by'])
const POWERSHELL_PARAMETER_COMMANDS: ReadonlySet<string> = new Set(['ls', 'mv', 'cp', 'rm', 'get', 'set', 'remove', 'copy', 'move', 'new'])

/** The flag as typed in the source, expanded from the diagnostic's span. */
function typedFlag(command: string, diagnostic: AstDiagnostic): { start: number; end: number; text: string } {
  let start = Math.max(0, Math.min(diagnostic.start, command.length))
  let end = Math.max(start, Math.min(diagnostic.end, command.length))
  while (start > 0 && !/[\s;|(){}&]/.test(command[start - 1]!)) start -= 1
  while (end < command.length && !/[\s;|(){}&]/.test(command[end]!)) end += 1
  return { start, end, text: command.slice(start, end) }
}

/** A rejected flag that belongs to a known bash or PowerShell family. */
function flagFinding(command: string, diagnostic: AstDiagnostic): Candidate | undefined {
  const match = FLAG_MESSAGE.exec(diagnostic.message)
  if (match === null) return undefined
  const commandName = match[1]!.toLowerCase()
  const typed = typedFlag(command, diagnostic)
  const flag = typed.text !== '' ? typed.text : '-' + match[2]!
  let id: RuleId | undefined
  if (commandName === 'ls' && /^-[A-Za-z]*R/.test(flag)) id = 'bash-flag'
  else if (commandName === 'mkdir' && /^-[A-Za-z]*p/.test(flag)) id = 'bash-flag'
  else if (DEPRECATED_COMMANDS.has(commandName) && DEPRECATED_FLAGS.test(flag)) id = 'deprecated-flags'
  else if (POWERSHELL_PARAMETER_COMMANDS.has(commandName) && POWERSHELL_PARAMETERS.test(flag)) id = 'powershell-parameter'
  if (id === undefined) return undefined
  return { id, fragment: flag, start: typed.start }
}

/** `-not (...)`, which is PowerShell negation rather than a Nushell operator. */
function notFinding(command: string, diagnostic: AstDiagnostic): Candidate | undefined {
  const slice = command.slice(diagnostic.start, diagnostic.end)
  if (/^(?:-not|-Not|!)/.test(slice)) return candidateFromSpan('powershell-not', command, diagnostic.start, diagnostic.end)
  const prefix = command.slice(0, diagnostic.start)
  const marker = /(?:-not|-Not|!)\s*$/.exec(prefix)?.[0].trim()
  if (marker === undefined) return undefined
  const start = prefix.lastIndexOf(marker)
  if (start < 0) return undefined
  return { id: 'powershell-not', fragment: fragmentOf(command, start, diagnostic.end), start }
}

/** Map a parser diagnostic to a refusal when its message is stable. */
function diagnosticFinding(command: string, diagnostic: AstDiagnostic): Candidate | undefined {
  const operation = shellOperationFinding(command, diagnostic)
  if (operation !== undefined) return operation
  const message = diagnostic.message
  if (message === 'Variable not found.') return variableFinding(command, diagnostic)
  // With an inherited `_` environment variable Nushell suggests `$env._`
  // instead of reporting the variable as missing.
  if (message === 'Use $env._ instead of $_.') {
    return candidateFromSpan('current-item', command, diagnostic.start, diagnostic.end)
  }
  if (message.includes('operator is not supported')) {
    return candidateFromSpan('and-or', command, diagnostic.start, diagnostic.end)
  }
  if (message === 'Parse mismatch: expected valid variable name.') {
    return candidateFromSpan('command-substitution', command, diagnostic.start, diagnostic.end)
  }
  if (message.includes('Incomplete variable')) {
    return candidateFromSpan('exit-status', command, diagnostic.start, diagnostic.end)
  }
  if (message.includes('percent sigil')) {
    const start = command[diagnostic.start - 1] === '%' ? diagnostic.start - 1 : diagnostic.start
    return candidateFromSpan('percent-sigil', command, start, diagnostic.end)
  }
  if (message === 'Unexpected redirection.') {
    return candidateFromSpan('pipe-redirect', command, diagnostic.start, diagnostic.end)
  }
  if (message === 'Unknown command.' || message === 'Attributes must be followed by a definition.') {
    const start = command[diagnostic.start - 1] === '@' ? diagnostic.start - 1 : diagnostic.start
    return candidateFromSpan('array-literal', command, start, diagnostic.end)
  }
  if (message === 'Unexpected keyword.') {
    return candidateFromSpan('export-assignment', command, diagnostic.start, diagnostic.end)
  }
  if (message === 'Parse mismatch: expected operator.') return notFinding(command, diagnostic)
  return flagFinding(command, diagnostic)
}

/** All refusals the parser's own diagnostics name. */
function diagnosticFindings(analysis: Analysis): Candidate[] {
  const findings: Candidate[] = []
  for (const diagnostic of analysis.diagnostics) {
    const finding = diagnosticFinding(analysis.command, diagnostic)
    if (finding !== undefined) findings.push(finding)
  }
  return findings
}

/** The first refusal in rule order, then by source position. */
function firstFinding(candidates: readonly Candidate[]): Candidate | undefined {
  let best: Candidate | undefined
  for (const candidate of candidates) {
    if (best === undefined) {
      best = candidate
      continue
    }
    const priority = PRIORITY.get(candidate.id) ?? Number.MAX_SAFE_INTEGER
    const bestPriority = PRIORITY.get(best.id) ?? Number.MAX_SAFE_INTEGER
    if (priority < bestPriority || (priority === bestPriority && candidate.start < best.start)) best = candidate
  }
  return best
}

/** Find the first refused syntax form in a command. */
export async function findSyntaxIssue(command: string, options: AnalyzeOptions = {}): Promise<Finding | undefined> {
  const analysis = await analyze(command, options)
  const finding = firstFinding([...diagnosticFindings(analysis), ...tokenFindings(analysis)])
  if (finding === undefined) return undefined
  return { id: finding.id, fragment: finding.fragment, fix: FIXES[finding.id] }
}

/** Build the refusal for one finding. */
export function refusal(finding: Finding, command: string): string {
  return [
    'dsh-nu: refusing a ' + finding.id + ' command. This deployment runs every shell command through Nushell only (nu --no-config-file -c), and bash/PowerShell syntax is not translated.',
    '',
    'Offending fragment: ' + JSON.stringify(finding.fragment),
    'Command: ' + JSON.stringify(command),
    '',
    finding.fix,
    '',
    'Fix that fragment and re-run. If the fragment is data rather than syntax, quote it; a leading caret (^program) forces an external binary. To exempt this call site, add it to foreignShellAllowlist, or set syntaxLint: false.',
  ].join('\n')
}

/** Throw when a command contains a refused syntax form. */
export async function assertNushellSyntax(command: string, options: SyntaxOptions = {}): Promise<void> {
  if (isAllowlisted(command, options.allow)) return
  const finding = await findSyntaxIssue(command, options)
  if (finding !== undefined) throw new Error(refusal(finding, command))
}

interface HintRule {
  id: string
  match: RegExp
  hint: string
}

/**
 * Hints for failures the tested Nushell actually reports. Every pattern and
 * hint below is exercised against real `nu 0.115.1` stderr in the test suite.
 */
const HINTS: readonly HintRule[] = [
  { id: 'stderr-redirect', match: /nu::parser::shell_outerr/, hint: '2>&1 is not Nushell. Write o+e> out.txt, or use (do { cmd } | complete) to capture both streams.' },
  { id: 'stderr-file', match: /nu::parser::shell_err\b/, hint: '2> file is not Nushell. Send stderr with e> err.txt; stdout is o> and both is o+e>.' },
  { id: 'path-not-found', match: /nu::shell::(?:io::)?(?:file_)?not_found/, hint: 'The path does not exist. Check it with path exists, or quote it if it contains spaces.' },
  { id: 'glob-pattern', match: /No matches found for|no matches found/i, hint: 'That glob matched nothing, and ls <glob> treats an empty match as an error. Use glob <pattern> (empty list is fine) or widen the pattern; ? in a path is a one-character wildcard in Nushell.' },
  { id: 'incompatible-path-access', match: /nu::shell::incompatible_path_access/, hint: 'A pipeline and or/and were mixed: wrap each comparison, (str contains "a") or (str contains "b"), or use one regex =~.' },
  { id: 'eval-block-with-input', match: /nu::shell::eval_block_with_input/, hint: 'A closure failed on its pipeline input. Name the parameter ({ |row| ... }) or use $in, and check the value type the block receives.' },
  { id: 'redirection-nothing', match: /expected redirection target/, hint: 'A redirection needs a target after the operator. Write cmd o> out.txt, or pipe into save -f file.' },
  { id: 'percent-sigil', match: /percent sigil/, hint: 'Nushell has no %{ ... } block. Use do { ... }, each { ... }, or a named closure.' },
  { id: 'column-not-found', match: /nu::shell::column_not_found/, hint: 'Nushell could not find that column or environment variable. For a table, inspect it with columns or first 1; for an optional variable, write $env.NAME?.' },
  { id: 'find-builtin', match: /find. command doesn't have flag/, hint: 'find here is the Nushell text-search builtin, not GNU find. Use glob "**/*.rs", or force the external tool with ^find . -name "*.rs".' },
  { id: 'deprecated-flag', match: /nu::parser::deprecated/, hint: 'That PowerShell-style flag is deprecated or gone: use first 20, last 20, uniq, or sort-by instead of -First / -Last / -Unique.' },
  { id: 'unknown-flag', match: /nu::parser::unknown_flag/, hint: 'Nushell flags differ from bash flags: check help <command> (for example ls --all, rm -r -f, mkdir a/b).' },
  { id: 'name-not-found', match: /nu::shell::name_not_found/, hint: 'The command or column name is not known here. Nushell columns are space-separated (select name size), and list the real ones with columns.' },
  { id: 'unknown-command', match: /nu::parser::unknown_command/, hint: 'That is not a Nushell command. Check the spelling, remove a foreign sigil such as @(...) / %{...}, or prefix an external binary with ^.' },
  { id: 'extra-positional', match: /nu::parser::extra_positional/, hint: 'Too many positional arguments. glob takes one pattern plus --depth; check help <command> for the accepted shape.' },
  { id: 'http-error', match: /nu::shell::io::connection_refused|nu::shell::http_error/, hint: 'The HTTP request failed (offline, DNS/TLS, refused connection, or a non-2xx status). Try http get --full <url> to inspect the status without raising.' },
  { id: 'immutable-assignment', match: /nu::parser::assignment_requires_mutable_variable/, hint: 'let variables are immutable. Declare it with mut before reassigning: mut x = 1; $x = 2.' },
  { id: 'env-var-not-var', match: /nu::parser::env_var_not_var/, hint: 'Environment values live under $env: write $env.PATH, not $PATH.' },
  { id: 'assignment-requires-variable', match: /nu::parser::assignment_requires_variable/, hint: '= assigns to a variable. A record literal uses { a: 1 }, and a table uses [[a]; [1]].' },
  { id: 'condition-not-boolean', match: /nu::shell::cant_convert[\s\S]{0,240}boolean/, hint: 'The condition is not a boolean. An empty check is ($x | is-empty), a file check is (path exists), and a comparison needs an operator such as ==.' },
  { id: 'cannot-pass-list-to-external', match: /nu::shell::cannot_pass_list_to_external/, hint: 'Nushell does not pass a list to an external program implicitly. Spread it (^git add ...$files) or convert it (to text).' },
  { id: 'needs-positive-value', match: /nu::shell::needs_positive_value/, hint: 'first and last take a positive count: first 3, not first -3.' },
  { id: 'unexpected-redirection', match: /nu::parser::unexpected_redirection/, hint: 'A redirection must end the command that produces the value; o>/e> after a pipe redirect nothing. Write cmd o> file, or pipe into save -f file.' },
  { id: 'is-a-directory', match: /nu::shell::io::is_a_directory/, hint: 'open --raw reads a file. List a directory with ls or glob instead of opening it.' },
  { id: 'operator-unsupported-type', match: /nu::(?:parser|shell)::operator_(?:unsupported_type|incompatible_types)/, hint: 'That operator does not accept this operand type. Convert first (into int, into string) or compare values of the same type.' },
  { id: 'type-mismatch', match: /nu::parser::input_type_mismatch|nu::shell::cant_convert/, hint: 'This value has the wrong type for that command. Parse it first (into int, into string) or check what the previous stage returned.' },
  { id: 'missing-external', match: /nu::shell::external_command/, hint: 'That external program is not installed. Nushell has a native equivalent for many tools; otherwise install it, or use ^program when the name clashes with a Nushell command.' },
  { id: 'permission-denied', match: /nu::shell::io::permission_denied|permission denied/i, hint: 'Permission was denied. This is a filesystem permission or sandbox policy issue, not a syntax problem: use a permitted path and do not retry another way.' },
  { id: 'read-only-filesystem', match: /read-only_filesystem_or_storage_medium/, hint: 'That filesystem is read-only. Choose a writable path, or check the sandbox policy; do not retry the same write.' },
  { id: 'empty-pipeline', match: /nu::shell::pipeline_mismatch/, hint: 'A stage received no input. Feed it explicitly, or check that the previous stage produced output.' },
  { id: 'exit-status', match: /Incomplete variable/, hint: '$? and similar bash variables are not Nushell. Use $env.LAST_EXIT_CODE? or (do { cmd } | complete).exit_code.' },
  { id: 'parse-error', match: /nu::parser::parse_mismatch|nu::parser::unclosed_delimiter/, hint: 'Nushell refused to parse this. Check quoting and parentheses: single quotes keep backslashes literal, and every brace, bracket, and parenthesis needs its pair in the same command.' },
]

/** All hint ids, in rule order. */
export const HINT_IDS: readonly string[] = HINTS.map((rule) => rule.id)

/** Options for {@link hintFor}. @deprecated Ignored: hints match stderr alone. */
export interface HintOptions {
  exitCode?: number | null
  stdout?: string | null
}

/** Pick one actionable hint for a failure, or nothing when no rule matches. */
export function hintFor(stderr: string, _options: HintOptions = {}): string | undefined {
  if (typeof stderr !== 'string' || stderr.length === 0) return undefined
  for (const rule of HINTS) {
    if (rule.match.test(stderr)) return 'Nushell hint (' + rule.id + '): ' + rule.hint
  }
  return undefined
}
