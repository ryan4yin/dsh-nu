Nushell syntax guide

## Rewrite bash and PowerShell habits

The preflight refuses the left-hand spellings before a process starts:

- `cmd 2>/dev/null` → `cmd e>| ignore` (even when the task says to ignore errors); `cmd 2>&1` → `cmd o+e> f`, or `(do { cmd } | complete)` to capture both streams.
- `cmd > out.txt` / `cmd 2> f` / `cmd &> f` → `cmd o> out.txt` / `cmd e> f` / `cmd o+e> f`; append with `o>>` / `e>>`. A bare `>` is comparison, so `cmd > f` would write no file.
- `cmd < in.txt` → `open --raw in.txt | cmd`; Nushell has no `<`, `<<`, or `<<<`.
- `a && b` → `a; b`; a failing external aborts the rest, so wrap it in `do -i { a }` when it may fail. `a || b` → `try { a } catch { b }`.
- `mkdir -p a/b` → `mkdir a/b`; `ls -la` → `ls --all --long`; `ls -R` → `ls **/*`.
- `for f in ...; do ...; done` → `for f in [...] { }` or `... | each { |f| ... }`; `test -d p` → `$p | path exists`.
- `$(cmd)` → `(cmd)`; `$?` → `(do { cmd } | complete).exit_code`; `$x = 1` → `let x = 1` or `mut x = 1`; `$env:VAR` → `$env.VAR`; PowerShell `$_` → a named parameter, `each { |row| $row.name }`.
- `cd d; cmd` → the call's `workdir`; nothing persists between calls.

Before sending, scan for `2>`, `&>`, `&&`, `mkdir -p`, `ls -R`, a bare `$name =`, and `sh -c`.

## Values and tables

- Bare words are strings or numbers; lists are `[1 2 3]`, records `{ name: "x", size: 3 }`. Optional access: `$rec.field?`, `$env.NAME?`.
- Single quotes are literal; double quotes process escapes such as `\n`. Interpolation is `$"text (expr)"` or `$'text (expr)'`; a raw string (`r#'…'#`) keeps everything literal.
- `ls`, `ps`, and `open file.json` produce tables: filter with `where`, project with `select`, extract with `get`, transform with `each`, order with `sort-by`. `where size > 1mb` compares typed sizes; quote strings (`where name == "a.md"`).
- Text: `"a,b" | split row ","`, `str trim`, `str replace -r '\d+' "#" --all`.
- A final list or table renders as a wide table; serialize it with `to text` for lines or `to json` for structure. Both return text, not a table.

## Control flow and output

- `if $c { } else { }`, `match $v { }`; combine conditions with `and` / `or`; `try { } catch { |err| $err.msg }`.
- `for x in $xs { }` is for side effects and cannot be piped; `each` maps to a list, `reduce` folds.
- `print` writes a line and returns nothing, so do not pipe after it. A non-final `echo` value is discarded.

## Files and external programs

- `open --raw notes.txt | lines`, `open data.json`; `save -f out.txt` overwrites, `save -a` appends; `glob **/*.md`; `"a" | path join b`.
- A bare word runs an external program when no Nushell command has that name; `^name` forces the external (`^find . -name x`), whose own flags are accepted. `which program` checks presence.

## Processes and waiting

- Wait for long work by starting it as a background call and reading its job output or the file it writes, not with a fixed `sleep` or `tail -f`.
- Find processes with `ps | where name =~ 'pattern'`; `ps | grep` filters rendered text, not names.
- Filtering output hides the exit code: keep it with `(do { cmd } | complete)`.
