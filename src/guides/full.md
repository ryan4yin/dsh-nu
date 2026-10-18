Nushell syntax guide

Shell calls run through Nushell as `nu --no-config-file -c "<command>"`. Each call is one isolated process; the working directory is the tool call's `workdir`.

## Values and quoting

- Bare words are strings or numbers; lists are `[1 2 3]` and records are `{ name: "x", size: 3 }`.
- Single quotes are literal; double quotes process escapes such as `\n`. Interpolation is only `$"text (expr)"`; a raw string keeps everything literal.
- Interpolation uses `$"text (expr)"`; subexpressions use parentheses: `(ls | length)`. Optional field access is `$rec.field?`; a missing required field errors.

## Pipelines and tables

- `ls`, `ps`, and `open file.json` produce structured values. Filter with `where`, project with `select`, extract with `get`, transform with `each`, order with `sort-by`.
- `where size > 1mb` compares typed sizes; quote strings (`where name == "a.md"`). Convert at the boundary with `to json` / `to csv` / `to text`; those return text, not a table. A raw list or table as the final value renders as a wide table, so serialize it deliberately: `to text` for lines or `to json` for structure.

## Variables and environment

- `let name = value` is immutable; `mut count = 0` then `$count = $count + 1` is reassignable.
- `$env.NAME` reads the environment; `$env.NAME = "value"` sets it for the rest of the process; `$env.NAME?` is optional.
- A shell variable is `$name`; a bare `name` is a word, and reading an unset `$name` is an error.

## Control flow

- `if $cond { ... } else { ... }`; branch with `match $value { ... }`; sequence commands with `;`; combine conditions with `and` / `or`.
- `for x in $xs { ... }` iterates for side effects and cannot be piped; `... | each {|x| ... }` maps to a list; `... | reduce` folds.
- `try { ... } catch {|err| $err.msg }` handles errors; `do { ... }` scopes one.

## Files and redirection

- Read: `open --raw notes.txt` for text, `open data.json` for structure, `lines` to split.
- Write: `save -f out.txt` overwrites; `save -a out.txt` appends; `mkdir a/b` creates parents.
- Redirect: `cmd o> out.txt`, `cmd e> err.txt`, `cmd o+e> all.txt`; append with `cmd o>> out.txt` / `cmd e>> err.txt`. Discard with `cmd e>| ignore` or `cmd o+e>| ignore`.
- A bare `>` is comparison, not redirection. Shell-style `cmd > out.txt` and `2>/dev/null` / `2>nul` are refused before running: use `o>`, `e>`, or `o+e>`; drop a stream with `e>| ignore`, and capture a failed call with `(do { cmd } | complete).exit_code`.
- `print` writes a line to stdout but returns nothing, so do not pipe after it. `echo` returns a value instead; a non-final `echo` is discarded. Let the final value stand when you want structured output.

## External commands

- A bare word runs an external program when no Nushell command has that name; `^program` always forces the external.
- Use `path join a b`, `path exists`, and `which` instead of string concatenation and `test -f`.
- A failing external aborts the rest of the command, so wrap it when the failure matters: `do -i { cmd }` or `cmd | complete`.

## Waiting and background jobs

- A fixed `sleep` is not a completion wait. Start long work in a background call and await its job output; a retry backoff is at most 5 seconds per attempt, inside a bounded retry.
- Do not follow a stream or open a pager as a wait: `tail -f`, `watch`, `less`, and interactive readers can block forever. Read the current tail, or wait for the job.
- Do not find a process with `ps | grep`; it matches the grep itself. Capture the job handle or PID when you start the process, and stop that handle.

## When Nushell refuses

This bundle fails closed when Nushell cannot be resolved; it never substitutes another shell.

The dialect preflight refuses bash/PowerShell habits before running them: numbered redirection, shell-style `>` and `2>` redirects, `$env:VAR`, bare assignment, `foreach`, cmdlets, `&&` / `||`, command substitution, `$?`, comma-separated columns, and bash flags on Nushell builtins. Fix the fragment the refusal names instead of working around it.
