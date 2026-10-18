Nushell syntax guide

Shell calls run through Nushell as `nu --no-config-file -c "<command>"`. Each call is one isolated process; the working directory is the tool call's `workdir`.

## Coming from bash or PowerShell

The preflight refuses these spellings before a process starts. Rewrite them:

- `cmd 2>/dev/null` → `cmd e>| ignore` (even when the task says to ignore errors); `cmd 2>&1` → `cmd o+e> f`, or `(do { cmd } | complete)` to capture both streams.
- `cmd > out.txt` / `cmd 2> f` / `cmd &> f` → `cmd o> out.txt` / `cmd e> f` / `cmd o+e> f`; append with `o>>` and `e>>`. A bare `>` is comparison or an argument, so `cmd > f` with a bare word writes no file.
- `a && b` → `a; b`; a failing external aborts the rest, so use `do -i { a }` when it may fail. `a || b` → `try { a } catch { b }`.
- `mkdir -p a/b` → `mkdir a/b`; `ls -la` → `ls --all --long`; `ls -R` → `ls **/*`.
- `cd d; cmd` → pass the call's `workdir`; `cd` does not persist between calls.
- `for f in ...; do ...; done` → `for f in [...] { }` or `... | each { |f| ... }`; `test -d p` → `$p | path exists`.
- `$env:VAR` → `$env.VAR`; `$?` → `(do { cmd } | complete).exit_code`; `$x = 1` → `let x = 1` or `mut x = 1`.
- `echo hi` → `print "hi"`; a bare `>` is comparison or an argument, so `cmd > f` writes no file.

`where $it =~ "x"` is a comparison, not an assignment, and is accepted.

Before sending a command, scan it for `2>`, `&>`, `&&`, `mkdir -p`, `ls -R`, a bare `$name =`, and `sh -c` or `bash -c`; the preflight refuses each.

## Values and quoting

- Bare words are strings or numbers; lists are `[1 2 3]` and records are `{ name: "x", size: 3 }`.
- Single quotes are literal; double quotes process escapes such as `\n`. Interpolation is `$"text (expr)"` or `$'text (expr)'`; a raw string (`r#'…'#`) keeps everything literal.
- Subexpressions use parentheses: `(ls | length)`. Optional field access is `$rec.field?`; a missing required field errors.

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
- A bare `>` is comparison or an argument, never redirection; write `o>`, `e>`, or `o+e>`. Shell spellings with a path-like target (`cmd > out.txt`, `cmd < in.txt`) become arguments and run silently; `2> f`, `2>&1`, and `<<<` fail to parse.
- `print` writes a line to stdout but returns nothing, so do not pipe after it. `echo` returns a value instead; a non-final `echo` is discarded. Let the final value stand when you want structured output.

## External commands

- A bare word runs an external program when no Nushell command has that name; `^program` always forces the external.
- Use `"a" | path join b`, `"p" | path exists`, and `which program` instead of string concatenation and `test -f`.
- A failing external aborts the rest of the command, so wrap it when the failure matters: `do -i { cmd }` or `cmd | complete`.

## Waiting and background jobs

- A fixed `sleep` is not a completion wait: start long work in a background call and await its job output; a retry backoff is at most 5 seconds per attempt, inside a bounded retry.
- Do not follow a stream (`tail -f`, `watch`, `less`) or locate a process with `ps | grep`, which filters the table's rendered text rather than process names; use `ps | where name =~ 'pattern'`. Wait on the job handle or the file it writes.

## When Nushell refuses

This bundle fails closed when Nushell cannot be resolved; it never substitutes another shell.

The preflight also refuses `foreach`, cmdlets, command substitution, comma-separated columns, bash flags on Nushell builtins, and shell input redirects (`< f`, `<<<`); fix the fragment the refusal names. `^program` runs an external binary, whose own flags are accepted.
