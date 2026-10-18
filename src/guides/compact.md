Nushell syntax guide

Calls run as `nu --no-config-file -c "<command>"`; one fresh process per call, no bash fallback. Pass `workdir` instead of `cd`.
Bash and PowerShell spellings are refused before running. Rewrite the habits that cause most refusals:
- Discard stderr with `e>| ignore`, never `2>/dev/null`: `cmd 2>/dev/null` → `cmd e>| ignore`. Capture both streams with `o+e>` or `(do { cmd } | complete)`; `cmd 2>&1` is refused.
- Redirect with `o>`, `e>`, `o+e>`: `cmd > f` → `cmd o> f`; `cmd 2> f` → `cmd e> f`.
- Sequence with `;`, not `&&`: `a && b` → `a; b`; a failing external aborts the rest, so wrap it with `do -i` when it may fail. `a || b` → `try { a } catch { b }`.
- Keep Nushell flags and loops: `mkdir -p a/b` → `mkdir a/b`; `ls -la` → `ls --all --long`; `ls -R` → `ls **/*`; `for f in ...; do ...; done` → `for f in [...] { }` or `... | each { |f| ... }`; `test -d p` → `$p | path exists`.
Final output: `to text` for lines or `to json` for structure; a raw table is token-heavy.
Pipelines pass structured values: `ls | where type == file | select name size`.
Files: `open --raw notes.txt | lines`, `save -f out.txt`, `glob **/*.md`, `mkdir a/b`.
Text: `"a,b" | split row ","`, `$"hi ($name)"`, `str trim`, `str replace -r "\d+" "#"`.
Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; filter with `where $it =~ "x"`; combine conditions with `and` / `or`.
Output: `print` writes a line; `echo` only returns a value. `for` is for side effects; use `each` for a list.
Wait for a background job or its output, not a fixed `sleep`; do not use `tail -f` or `ps | grep`.
A failure prints `[exit code: N]` and possibly one `Nushell hint (...)` line.
