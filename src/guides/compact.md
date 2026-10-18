Nushell syntax guide

Calls run as `nu --no-config-file -c "<command>"`; one fresh process per call, no bash fallback.
Pipelines pass structured values: `ls | where type == file | select name size`.
Files: `open --raw notes.txt | lines`, `save -f out.txt`, `glob **/*.md`, `mkdir a/b`.
Text: `"a,b" | split row ","`, `$"hi ($name)"`, `str trim`, `str replace -r "\d+" "#"`.
Variables: `let x = 1`, `mut x = 2`, `$env.NAME`, `$env.NAME?`, `$rec.field?`; sequence commands with `;`; combine conditions with `and` / `or`.
Output: `print` writes a line; `echo` only returns a value. `for` is for side effects; use `each` for a list.
Redirect: `cmd o> out.txt`, `cmd e> err.txt`, `cmd o+e> all.txt`; capture with `(do { cmd } | complete)`.
Wait for a background job or its output, not a fixed `sleep`; do not use `tail -f` or `ps | grep`.
A failure prints `[exit code: N]` and possibly one `Nushell hint (...)` line.
