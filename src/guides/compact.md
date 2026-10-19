Nushell syntax guide

Calls run as `nu --no-config-file -c`; one fresh process per call, no bash fallback. Pass `workdir` instead of `cd`.
Bash and PowerShell spellings are refused before running. Rewrite the habits that cause most refusals:
- Discard stderr with `e>| ignore`, never `2>/dev/null` (even when the task says to ignore errors): `cmd 2>/dev/null` → `cmd e>| ignore`. Capture both streams with `o+e>` or `(do { cmd } | complete)`; `cmd 2>&1` is refused.
- Redirect with `o>`, `e>`, `o+e>`: `cmd > out.txt` → `cmd o> out.txt`; `cmd 2> f` → `cmd e> f`. A bare `>` is comparison; in argument position the preflight refuses it instead of treating it as a redirect.
- Sequence with `;`, not `&&`: `a && b` → `a; b`; a failing external aborts the rest, so wrap it with `do -i` when it may fail. `a || b` → `try { a } catch { b }`.
- Keep Nushell flags and loops: `mkdir -p a/b` → `mkdir a/b`; `ls -la` → `ls --all --long`; `ls -R` → `ls **/*`; `for f in ...; do ...; done` → `for f in [...] { }` or `... | each { |f| ... }`; `test -d p` → `$p | path exists`.
- Before sending, scan for `2>`, `&>`, `&&`, `mkdir -p`, `ls -R`, a bare `$name =`, and `sh -c`; the preflight refuses each.
Serialize output: `to text` for lines, `to json` for structure.
Files: `open --raw notes.txt | lines`, `save -f out.txt`, `glob **/*.md`, `mkdir a/b`.
Text: `"a,b" | split row ","`, `$"hi ($name)"` or `$'hi ($name)'`, `str trim`, `str replace -r '\d+' "#" --all`.
Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; filter with `where $it =~ "x"`; combine conditions with `and` / `or`.
