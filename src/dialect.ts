/**
 * Dialect preflight and failure hints.
 *
 * Nushell does not translate bash or PowerShell syntax: some habits fail at
 * parse time, some at run time, and some quietly do the wrong thing (a plain
 * greater-than is a comparison; a numbered stderr redirect is an argument).
 * The preflight refuses the loudly failing habits before a process is spawned;
 * the hints explain a failure Nushell actually reported.
 *
 * Both are heuristics over a view with quoted text and comments blanked, so a
 * string that merely mentions a habit is not one. They are tuned to the tested
 * Nushell version and tested differentially against it.
 */

import { codeView } from './guard.js'

/** A refused habit. */
export type RuleId =
  | 'stderr-redirect'
  | 'stderr-file'
  | 'powershell-env'
  | 'bare-assignment'
  | 'foreach-loop'
  | 'powershell-cmdlet'
  | 'and-or'
  | 'command-substitution'
  | 'exit-status'
  | 'bash-flag'
  | 'comma-column'

/** One refused habit and the shape that replaces it. */
export interface Finding {
  id: RuleId
  fragment: string
  fix: string
}

/** Options for the preflight. */
export interface DialectOptions {
  allow?: readonly RegExp[]
}

interface Rule {
  id: RuleId
  match: RegExp
  fix: string
}

const RULES: readonly Rule[] = [
  {
    id: 'stderr-redirect',
    match: /(?:^|[\s;|(])(?:\d+\s*)?>&\s*\d+/,
    fix: 'Nushell has no 2>&1. Redirect with o+e> out.txt, or capture both streams with (do { cmd } | complete).',
  },
  {
    id: 'stderr-file',
    match: /(?:^|[\s;|(])\d+\s*>>?\s*[^\s|;&]+/,
    fix: 'Nushell has no numbered redirection. Send stderr with e> err.txt, stdout with o> out.txt, both with o+e> out.txt.',
  },
  {
    id: 'powershell-env',
    match: /\$env:[A-Za-z_]/,
    fix: 'PowerShell writes $env:NAME; Nushell writes $env.NAME (optional read: $env.NAME?).',
  },
  {
    id: 'bare-assignment',
    match: /(?:^|[\s;|(])\$[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/,
    fix: 'Nushell has no bare $x = assignment: bind with let x = ... (immutable) or mut x = ... (reassignable); the environment is $env.x = ....',
  },
  {
    id: 'foreach-loop',
    match: /\bforeach\s*\(/,
    fix: 'Nushell loops are for item in $items { ... }; transform a list with ... | each { |item| ... }.',
  },
  {
    id: 'powershell-cmdlet',
    match: /\b(?:Get|Set|Remove|Copy|Move|Test|Join|Select|Where|ForEach|New|Invoke|Write|Add|Clear|Out|Start|Stop|Sort|Group|Measure|ConvertTo|ConvertFrom|Rename|Split|Format|Import|Export|Read|Update)-[A-Za-z]+\b/,
    fix: 'PowerShell cmdlets have one-word Nushell equivalents: Get-ChildItem -> ls, Get-Content -> open --raw, Select-Object -> select or first, Where-Object -> where.',
  },
  {
    id: 'and-or',
    match: /&&|\|\|/,
    fix: 'Nushell has no && or ||. Separate commands with a semicolon (a failing external aborts the rest), or branch with if / and / or.',
  },
  {
    id: 'command-substitution',
    match: /\$\([^()]+\)/,
    fix: 'Nushell substitutes with (command) for a value; use a subexpression where the value is needed.',
  },
  {
    id: 'exit-status',
    match: /\$\?/,
    fix: 'Nushell has no $?. Read (do { cmd } | complete).exit_code, or $env.LAST_EXIT_CODE? after an external command.',
  },
  {
    id: 'bash-flag',
    match: /\b(?:ls\s+-[A-Za-z]*R|mkdir\s+-[A-Za-z]*p)/,
    fix: 'Unknown Nushell flags: mkdir a/b (parents are automatic), ls --all --long. External tools keep their own flags, but Nushell builtins do not accept bash ones.',
  },
  {
    id: 'comma-column',
    match: /\b(?:select|sort-by|where)\b[^;|]*\b[A-Za-z_][A-Za-z0-9_-]*\s*,\s*[A-Za-z_][A-Za-z0-9_-]*/,
    fix: 'Nushell has no comma-separated columns: select name size. Lists are [1, 2], but command arguments are space-separated.',
  },
]

/** All refusal rule ids, in rule order. */
export const RULE_IDS: readonly string[] = RULES.map((rule) => rule.id)

/** Find the first refused habit in a command. */
export function findHabit(command: string): Finding | undefined {
  const view = codeView(command)
  for (const rule of RULES) {
    const match = rule.match.exec(view)
    if (match === null) continue
    // $x = is valid Nushell for a variable declared with mut, and an error
    // otherwise; only the second case is a refused habit.
    if (rule.id === 'bare-assignment') {
      const name = /\$([A-Za-z_][A-Za-z0-9_]*)/.exec(match[0])?.[1]
      if (name !== undefined && new RegExp('\\bmut\\s+' + name + '\\b').test(view)) continue
    }
    return { id: rule.id, fragment: match[0].trim(), fix: rule.fix }
  }
  return undefined
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
    'Fix that fragment and re-run. If the fragment is data rather than syntax, quote it; a leading caret (^program) forces an external binary. To exempt this call site, add it to foreignShellAllowlist, or set dialectLint: false.',
  ].join('\n')
}

/** Throw when a command contains a refused habit. */
export function assertNuDialect(command: string, options: DialectOptions = {}): void {
  if ((options.allow ?? []).some((pattern) => pattern.test(command))) return
  const finding = findHabit(command)
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
  { id: 'column-not-found', match: /nu::shell::column_not_found/, hint: 'Nushell could not find that column or environment variable. For a table, inspect it with columns or first 1; for an optional variable, write $env.NAME?.' },
  { id: 'unknown-flag', match: /nu::parser::unknown_flag/, hint: 'Nushell flags differ from bash flags: check help <command> (for example ls --all, rm -r -f, mkdir a/b).' },
  { id: 'immutable-assignment', match: /nu::parser::assignment_requires_mutable_variable/, hint: 'let variables are immutable. Declare it with mut before reassigning: mut x = 1; $x = 2.' },
  { id: 'env-var-not-var', match: /nu::parser::env_var_not_var/, hint: 'Environment values live under $env: write $env.PATH, not $PATH.' },
  { id: 'assignment-requires-variable', match: /nu::parser::assignment_requires_variable/, hint: '= assigns to a variable. A record literal uses { a: 1 }, and a table uses [[a]; [1]].' },
  { id: 'condition-not-boolean', match: /nu::shell::cant_convert[\s\S]{0,240}boolean/, hint: 'The condition is not a boolean. An empty check is ($x | is-empty), a file check is (path exists), and a comparison needs an operator such as ==.' },
  { id: 'cannot-pass-list-to-external', match: /nu::shell::cannot_pass_list_to_external/, hint: 'Nushell does not pass a list to an external program implicitly. Spread it (^git add ...$files) or convert it (to text).' },
  { id: 'needs-positive-value', match: /nu::shell::needs_positive_value/, hint: 'first and last take a positive count: first 3, not first -3.' },
  { id: 'unexpected-redirection', match: /nu::parser::unexpected_redirection/, hint: 'A redirection must end the command that produces the value; o>/e> after a pipe redirect nothing. Write cmd o> file, or pipe into save -f file.' },
  { id: 'is-a-directory', match: /nu::shell::io::is_a_directory/, hint: 'open --raw reads a file. List a directory with ls or glob instead of opening it.' },
  { id: 'operator-unsupported-type', match: /nu::parser::operator_unsupported_type/, hint: 'That operator does not accept this operand type. Convert first (into int, into string) or compare values of the same type.' },
  { id: 'type-mismatch', match: /nu::parser::input_type_mismatch|nu::shell::cant_convert/, hint: 'This value has the wrong type for that command. Parse it first (into int, into string) or check what the previous stage returned.' },
  { id: 'missing-external', match: /nu::shell::external_command/, hint: 'That external program is not installed. Nushell has a native equivalent for many tools; otherwise install it, or use ^program when the name clashes with a Nushell command.' },
  { id: 'permission-denied', match: /nu::shell::io::permission_denied|permission denied/i, hint: 'Permission was denied. This is a filesystem permission or sandbox policy issue, not a syntax problem: use a permitted path and do not retry another way.' },
  { id: 'read-only-filesystem', match: /read-only_filesystem_or_storage_medium/, hint: 'That filesystem is read-only. Choose a writable path, or check the sandbox policy; do not retry the same write.' },
  { id: 'empty-pipeline', match: /nu::shell::pipeline_mismatch/, hint: 'A stage received no input. Feed it explicitly, or check that the previous stage produced output.' },
  { id: 'exit-status', match: /Incomplete variable/, hint: '$? and similar bash variables are not Nushell. Use $env.LAST_EXIT_CODE? or (do { cmd } | complete).exit_code.' },
  { id: 'parse-error', match: /nu::parser::unclosed_delimiter/, hint: 'Nushell refused to parse this. Check quoting and parentheses: single quotes keep backslashes literal, and every brace, bracket, and parenthesis needs its pair in the same command.' },
]

/** All hint ids, in rule order. */
export const HINT_IDS: readonly string[] = HINTS.map((rule) => rule.id)

/** Options for {@link hintFor}. */
export interface HintOptions {
  exitCode?: number | null
  stdout?: string | null
}

/** Pick one actionable hint for a failure, or nothing when no rule matches. */
export function hintFor(stderr: string, options: HintOptions = {}): string | undefined {
  if (typeof stderr !== 'string' || stderr.length === 0) return undefined
  for (const rule of HINTS) {
    if (rule.match.test(stderr)) return 'Nushell hint (' + rule.id + '): ' + rule.hint
  }
  return undefined
}
