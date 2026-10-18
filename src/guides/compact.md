Nushell syntax guide

Calls run as `nu --no-config-file -c "<command>"`; one fresh process per call, no bash fallback; it fails closed if Nushell is unresolved.
Prefer native read, grep, glob, write, and edit tools; use shell file forms when already in a shell.
Final output: `to text` for lines or `to json` for structure; a raw table is token-heavy.
Pipelines pass structured values: `ls | where type == file | select name size`.
Files: `open --raw notes.txt | lines`, `save -f out.txt`, `glob **/*.md`, `mkdir a/b`.
Text: `"a,b" | split row ","`, `$"hi ($name)"`, `str trim`, `str replace -r "\d+" "#"`.
Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; sequence commands with `;`; combine conditions with `and` / `or`.
Output: `print` writes a line; `echo` only returns a value. `for` is for side effects; use `each` for a list.
Redirect: `cmd o> out.txt`, `cmd e> err.txt`, `cmd o+e> all.txt`; capture with `(do { cmd } | complete)`.
Wait for a background job or its output, not a fixed `sleep`; do not use `tail -f` or `ps | grep`.
A failure prints `[exit code: N]` and possibly one `Nushell hint (...)` line.
