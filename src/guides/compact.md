Nushell syntax guide

Rewrite the bash habits the preflight refuses:
- External `cmd 2>/dev/null` → `^cmd e> /dev/null` on POSIX, keeping stdout and exit status; portable capture: `(do { ^cmd } | complete)`. Internal errors need `try { cmd } catch { |err| $err.msg }`; `do -i { cmd }` intentionally ignores failure. `cmd 2>&1` → `^cmd o+e> f`.
- `cmd > out.txt` → `cmd o> out.txt`; `cmd 2> f` → `cmd e> f`. A bare `>` is comparison.
- `a && b` → `a; b` (wrap a command that may fail in `do -i { }`); `a || b` → `try { a } catch { b }`.
- `mkdir -p a/b` → `mkdir a/b`; `ls -la` → `ls --all --long`; `ls -R` → `ls **/*`; `for f in ...; do ...; done` → `for f in [...] { }` or `... | each { |f| ... }`; `test -d p` → `$p | path exists`.
- Before sending, scan for `2>`, `&>`, `&&`, `mkdir -p`, `ls -R`, a bare `$name =`, and `sh -c`.
Serialize a final table: `to text` for lines, `to json` for structure.
Files: `open --raw notes.txt | lines`, `save -f out.txt`; `ls **/* | where type == file | get name` gives cwd-relative paths, while `glob **/*.md` gives absolute ones and takes no `--type` flag; a script that is not executable needs `chmod +x script.sh` first.
Text: `"a,b" | split row ","`, `$"hi ($name)"`, `str trim`, `str replace -r '\d+' "#" --all`.
Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; filter with `where $it =~ "x"`; combine conditions with `and` / `or`; `$env` is a record (`$env | transpose key value`), not a table; `date now | format date '%F'` formats a date; a `mut` variable keeps its first value's type, so start it with the final type.
Exit codes: `(do { ^cmd } | complete).exit_code` for an external command; a builtin such as `open` needs `try { } catch { }`. A caret works only in command position: `^xargs -0 rg …`, not `xargs -0 ^rg`.
Waiting: read a background job's output, not a fixed `sleep`; find processes with `ps | where name =~ 'x'`.
