Nushell syntax guide

Rewrite the bash habits the preflight refuses:
- `cmd 2>/dev/null` → `cmd e>| ignore` (even when the task says to ignore errors); `cmd 2>&1` → `cmd o+e> f` or `(do { cmd } | complete)`.
- `cmd > out.txt` → `cmd o> out.txt`; `cmd 2> f` → `cmd e> f`. A bare `>` is comparison.
- `a && b` → `a; b` (wrap a command that may fail in `do -i { }`); `a || b` → `try { a } catch { b }`.
- `mkdir -p a/b` → `mkdir a/b`; `ls -la` → `ls --all --long`; `ls -R` → `ls **/*`; `for f in ...; do ...; done` → `for f in [...] { }` or `... | each { |f| ... }`; `test -d p` → `$p | path exists`.
- Before sending, scan for `2>`, `&>`, `&&`, `mkdir -p`, `ls -R`, a bare `$name =`, and `sh -c`.
Serialize a final table: `to text` for lines, `to json` for structure.
Files: `open --raw notes.txt | lines`, `save -f out.txt`, `glob **/*.md`.
Text: `"a,b" | split row ","`, `$"hi ($name)"`, `str trim`, `str replace -r '\d+' "#" --all`.
Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; filter with `where $it =~ "x"`; combine conditions with `and` / `or`.
Waiting: read a background job's output, not a fixed `sleep`; find processes with `ps | where name =~ 'x'`.
