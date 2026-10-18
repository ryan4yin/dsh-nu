/**
 * Nushell syntax preflight and failure hints.
 *
 * Nushell does not translate bash or PowerShell syntax: some forms fail at
 * parse time, some at run time, and some quietly do the wrong thing (a plain
 * greater-than is a comparison; a numbered stderr redirect is an argument).
 * The preflight refuses the loudly failing forms before a process is spawned;
 * the hints explain a failure Nushell actually reported.
 *
 * Both are heuristics over a view with quoted text and comments blanked, so a
 * string that merely mentions a syntax form is not one. They are tuned to the
 * tested Nushell version and tested differentially against it.
 */

import { codeView } from './guard.js'

/** A refused syntax form. */
export type RuleId =
  | 'stderr-redirect'
  | 'stderr-file'
  | 'stderr-as-word'
  | 'stdout-redirect'
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
  | 'prefix-assignment'
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
export interface SyntaxOptions {
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
  // `2> target` with a space is a Nushell parse error; every other numbered
  // redirect spelling is lexed as a word and runs.
  {
    id: 'stderr-as-word',
    match: /(?:^|[\s;|(])(?:\d+>>|\d+>(?!=)[^\s;|&()]+|1>(?=\s|$)|\d+>&(?!1)|&>)/,
    fix: 'Nushell reads 2>... as an ordinary argument: the command runs, stderr is not redirected, and nothing fails. Drop stderr with e>| ignore, send it with e> err.txt, keep both streams with o+e> all.txt, or capture both with (do { cmd } | complete).',
  },
  {
    id: 'stderr-file',
    match: /(?:^|[\s;|(])2>\s+[^\s;|&()]+/,
    fix: '2> is a shell redirection, and Nushell rejects it. Send stderr with e> err.txt, stdout with o> out.txt, both with o+e> out.txt.',
  },
  // A bare `>` is also comparison, so only a path-like target (extension,
  // slash, colon, or nul) is refused; `where size > 1kb` stays valid.
  {
    id: 'stdout-redirect',
    match: /(?:^|[\s;|(])>>?\s+(?:(?:[^\s;|&(){}]*[\\/:][^\s;|&(){}]*)|(?:[^\s;|&(){}]*[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z0-9]{1,8})|(?:\.[A-Za-z][A-Za-z0-9]{0,7})|(?:[Nn][Uu][Ll]))(?=[\s;|&)}]|$)/,
    fix: 'In Nushell a bare > is comparison: cmd > out.txt passes > and the filename as arguments, exits 0, and writes no file. Redirect stdout with o> out.txt, append with o>> out.txt, keep both streams with o+e> out.txt, or pipe into save -f out.txt.',
  },
  {
    id: 'powershell-env',
    match: /\$env:[A-Za-z_]/,
    fix: 'PowerShell writes $env:NAME; Nushell writes $env.NAME (optional read: $env.NAME?).',
  },
  {
    id: 'bare-assignment',
    // `$x =~ ...` is a comparison and `$x => ...` is a match-arm binding;
    // neither is an assignment.
    match: /(?:^|[\s;|(])\$[A-Za-z_][A-Za-z0-9_]*\s*=(?![=~>])/,
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
    // A leading caret forces the external binary, whose flags are its own.
    match: /(?<!\^)\b(?:ls\s+-[A-Za-z]*R|mkdir\s+-[A-Za-z]*p)/,
    fix: 'Unknown Nushell flags: mkdir a/b (parents are automatic), ls --all --long. External tools keep their own flags, but Nushell builtins do not accept bash ones.',
  },
  {
    id: 'comma-column',
    match: /\b(?:select|sort-by|where)\b[^;|]*\b[A-Za-z_][A-Za-z0-9_-]*\s*,\s*[A-Za-z_][A-Za-z0-9_-]*/,
    fix: 'Nushell has no comma-separated columns: select name size. Lists are [1, 2], but command arguments are space-separated.',
  },
  {
    id: 'array-literal',
    match: /(?:^|[\s;|(])@\(/,
    fix: 'Nushell lists are [1 2 3]; PowerShell @(...) is not an array literal.',
  },
  {
    id: 'export-assignment',
    match: /(?:^|[;\n])\s*export\s+[A-Za-z_][A-Za-z0-9_]*\s*=/,
    fix: 'Nushell has no export NAME=. Set an environment value with $env.NAME = ...; module exports use export def / export const.',
  },
  {
    id: 'prefix-assignment',
    match: /(?:^|[;\n])\s*[A-Za-z_][A-Za-z0-9_]*=[^\s;|]+\s+[A-Za-z_^]/,
    fix: 'Per-command environment assignment is not Nushell. Set $env.NAME = ... first, then run the command.',
  },
  {
    id: 'current-item',
    match: /\$_\.|\$PSItem\b/,
    fix: 'PowerShell uses $_. Nushell closures name their item: ls | each { |item| $item.name }.',
  },
  {
    id: 'powershell-not',
    match: /(?:^|[\s;(])(?:-not|-Not)\s+\(|(?:^|[\s;(])!\s*\(/,
    fix: 'Nushell negates with not or by comparing: if not ($x == 1) { ... } or if $x != 1 { ... }.',
  },
  {
    id: 'deprecated-flags',
    match: /\b(?:select|sort-by|sort|measure|group-by)\s+-(?:First|Last|Unique|Skip|Descending|Ascending)\b/i,
    fix: 'PowerShell verbs are not Nushell flags: use first 20, last 20, uniq, or sort-by.',
  },
  {
    id: 'powershell-parameter',
    match: /\b(?:ls|mv|cp|rm|Get|Set|Remove|Copy|Move|New)\b[^;|]*\s-(?:ErrorAction|Force|Recurse)\b/,
    fix: 'PowerShell common parameters do not exist here: drop -ErrorAction / -Force / -Recurse and use Nushell flags or ignore errors with do -i.',
  },
  {
    id: 'negative-count',
    match: /\b(?:first|last|skip|take|drop)\s+-\d+/,
    fix: 'Counts are positive: first 3, last 40. Negative counts are not supported.',
  },
  {
    id: 'percent-sigil',
    match: /(?:^|[\s;|(])%\{/,
    fix: 'Nushell has no %{ ... } block. Use do { ... }, each { ... }, or a named closure.',
  },
  {
    id: 'pipe-redirect',
    match: /\|\s*(?:o|e|o\+e)>>?/,
    fix: 'A redirection must end the command that produces the value. Pipe into save -f file instead of | o> file.',
  },
  {
    id: 'glob-named-arguments',
    match: /\bglob\s+[A-Za-z_][A-Za-z0-9_]*=/,
    fix: 'glob takes one pattern and an optional --depth, not named pattern=/path= arguments: glob "**/*.rs".',
  },
]

/** All refusal rule ids, in rule order. */
export const RULE_IDS: readonly string[] = RULES.map((rule) => rule.id)

/** Find the first refused syntax form in a command. */
export function findSyntaxIssue(command: string): Finding | undefined {
  const view = codeView(command)
  for (const rule of RULES) {
    const match = rule.match.exec(view)
    if (match === null) continue
    // $x = is valid Nushell for a variable declared with mut, and an error
    // otherwise; only the second case is a refused syntax form.
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
    'Fix that fragment and re-run. If the fragment is data rather than syntax, quote it; a leading caret (^program) forces an external binary. To exempt this call site, add it to foreignShellAllowlist, or set syntaxLint: false.',
  ].join('\n')
}

/** Throw when a command contains a refused syntax form. */
export function assertNushellSyntax(command: string, options: SyntaxOptions = {}): void {
  if ((options.allow ?? []).some((pattern) => pattern.test(command))) return
  const finding = findSyntaxIssue(command)
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
