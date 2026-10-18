/**
 * Model-facing prose: mandatory shell rules, a Nushell syntax guide, and the
 * rewritten shell-tool descriptions. Every rule pairs a bash/PowerShell habit
 * with the Nushell spelling that replaces it.
 */

/** Guide variants the config accepts. */
export type GuideVariant = 'full' | 'compact' | 'off'

/** Options for {@link buildGuide}. */
export interface GuideOptions {
  variant?: GuideVariant
  version?: string | undefined
}

/** The short mandatory section: rules a shell call must not break. */
export function buildRules(): string {
  return [
    'Shell: Nushell only',
    '',
    'Every shell call runs through Nushell as `nu --no-config-file -c "<command>"`. There is no bash or PowerShell fallback, so do not write bash/PowerShell syntax and do not hand work to another shell.',
    '',
    '- One process per call: variables, aliases, and `cd` do not persist. Pass `workdir` instead of changing directory.',
    '- Values are structured: pipelines pass tables and records. Use `where`, `select`, `get`, `each`, and `sort-by` instead of parsing text. Optional field access is `$rec.field?`.',
    '- Redirect stdout with `o> f`, stderr with `e> f`, both with `o+e> f`; discard a stream with `e>| ignore` or `o+e>| ignore`; capture a record with `(do { cmd } | complete)`.',
    '- Variables are `let x = ...` and `mut x = ...`; the environment is `$env.NAME` (optional read: `$env.NAME?`).',
    '- Control flow is `if` / `for x in $xs { }` / `match`. `for` is for side effects and cannot be piped; build a list with `... | each {|x| ... }`.',
    '- `echo` only produces a pipeline value; as a non-final statement it is discarded. Use `print` for output that must appear.',
    '- External programs start with their name; prefix with `^` to force the external binary when a Nushell command has the same name (`^ls`).',
    '- Non-zero exits are reported as `[exit code: N]`; a failed call may carry one `Nushell hint (...)` line naming the fix. Read it before retrying the same shape.',
  ].join('\n')
}

/** The full syntax guide, or its compact form. */
export function buildGuide(options: GuideOptions = {}): string {
  const variant = options.variant ?? 'full'
  if (variant === 'off') return ''
  const header = options.version === undefined ? 'Nushell syntax guide' : 'Nushell syntax guide (Nushell ' + options.version + ')'
  if (variant === 'compact') {
    return [
      header,
      '',
      'Calls run as `nu --no-config-file -c "<command>"`; one fresh process per call, no bash fallback.',
      'Pipelines pass structured values: `ls | where type == file | select name size`.',
      'Files: `open --raw notes.txt | lines`, `save -f out.txt`, `glob **/*.md`, `mkdir a/b`.',
      'Text: `"a,b" | split row ","`, `$"hi ($name)"`, `str trim`, `str replace -r "\\d+" "#"`.',
      'Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; sequence commands with `;`; combine conditions with `and` / `or`.',
      'Output: `print` writes a line; `echo` only returns a value. `for` is for side effects; use `each` for a list.',
      'Redirect: `cmd o> out.txt`, `cmd e> err.txt`, `cmd o+e> all.txt`; capture with `(do { cmd } | complete)`.',
      'A failure prints `[exit code: N]` and possibly one `Nushell hint (...)` line.',
    ].join('\n')
  }
  return [
    header,
    '',
    'Shell calls run through Nushell as `nu --no-config-file -c "<command>"`. Each call is one isolated process; the working directory is the tool call\'s `workdir`.',
    '',
    '## Values and quoting',
    '',
    '- Bare words are strings or numbers; lists are `[1 2 3]` and records are `{ name: "x", size: 3 }`.',
    '- Single and double quotes are literal; double quotes still process escapes such as `\n`. Interpolation is only `$"text (expr)"`; a raw string keeps everything literal.',
    '- Interpolation uses `$"text (expr)"`; subexpressions use parentheses: `(ls | length)`. Optional field access is `$rec.field?`; a missing required field errors.',
    '',
    '## Pipelines and tables',
    '',
    '- `ls`, `ps`, and `open file.json` produce structured values. Filter with `where`, project with `select`, extract with `get`, transform with `each`, order with `sort-by`.',
    '- `where size > 1mb` compares typed sizes; quote strings (`where name == "a.md"`). Convert at the boundary with `to json` / `to csv` / `to text`; those return text, not a table.',
    '',
    '## Variables and environment',
    '',
    '- `let name = value` is immutable; `mut count = 0` then `$count = $count + 1` is reassignable.',
    '- `$env.NAME` reads the environment; `$env.NAME = "value"` sets it for the rest of the process; `$env.NAME?` is optional.',
    '- A shell variable is `$name`; a bare `name` is a word, and reading an unset `$name` is an error.',
    '',
    '## Control flow',
    '',
    '- `if $cond { ... } else { ... }`; branch with `match $value { ... }`; sequence commands with `;`; combine conditions with `and` / `or`.',
    '- `for x in $xs { ... }` iterates for side effects and cannot be piped; `... | each {|x| ... }` maps to a list; `... | reduce` folds.',
    '- `try { ... } catch {|err| $err.msg }` handles errors; `do { ... }` scopes one.',
    '',
    '## Files and redirection',
    '',
    '- Read: `open --raw notes.txt` for text, `open data.json` for structure, `lines` to split.',
    '- Write: `save -f out.txt` overwrites; `save -a out.txt` appends; `mkdir a/b` creates parents.',
    '- Redirect: `cmd o> out.txt`, `cmd e> err.txt`, `cmd o+e> all.txt`; append with `cmd o>> out.txt` / `cmd e>> err.txt`. Discard with `cmd e>| ignore` or `cmd o+e>| ignore`.',
    '- A bare `>` is comparison, not redirection; `2>` is not a redirect either, and `2>/dev/null` / `2>nul` are accepted as ordinary arguments and silently do nothing. Capture a failed call with `(do { cmd } | complete).exit_code`.',
    '- `print` writes a line to stdout but returns nothing, so do not pipe after it. `echo` returns a value instead; a non-final `echo` is discarded. Let the final value stand when you want structured output.',
    '',
    '## External commands',
    '',
    '- A bare word runs an external program when no Nushell command has that name; `^program` always forces the external.',
    '- Use `path join a b`, `path exists`, and `which` instead of string concatenation and `test -f`.',
    '- A failing external aborts the rest of the command, so wrap it when the failure matters: `do -i { cmd }` or `cmd | complete`.',
    '',
    '## When Nushell refuses',
    '',
    'The dialect preflight refuses bash/PowerShell habits before running them: numbered redirection, `$env:VAR`, bare assignment, `foreach`, cmdlets, `&&` / `||`, command substitution, `$?`, comma-separated columns, and bash flags on Nushell builtins. Fix the fragment the refusal names instead of working around it.',
  ].join('\n')
}

/** Options for {@link buildToolDescription}. */
export interface ToolDescriptionOptions {
  tool?: string
}

/** The model-facing description of a shell tool, in Nushell terms. */
export function buildToolDescription(options: ToolDescriptionOptions = {}): string {
  return [
    'Execute a Nushell command. This deployment runs every command through Nushell (nu --no-config-file -c); bash and PowerShell are never spawned. The dialect is Nushell, not bash or PowerShell.',
    '',
    'Provide `description` before `command`: a clear, concise description of what the command does in active voice, 5-10 words, shown to the user.',
    'The `command` argument is Nushell syntax. Each call is a fresh process, so state does not persist.',
    '',
    'Budgets and behavior mirror the host tool: default timeout, per-call timeout override, output byte cap with spill-on-overflow, background execution, and the current working directory apply unchanged.',
    '',
    'A command that hands work to another shell is refused before it runs. Bash/PowerShell habits get a Nushell spelling in the error. A failing command may carry one `Nushell hint (...)` line on stderr; read it before retrying.',
    '',
    'When you need output, let the final pipeline value stand, or put `print` last: it returns nothing, so a pipeline after it has no input. A failing command is reported as `[exit code: N]`.',
  ].join('\n')
}

/** The command parameter description shared by both shell tools. */
export const NUSHELL_COMMAND_DESCRIPTION = 'The Nushell command to execute (Nushell syntax; not bash or PowerShell).'
