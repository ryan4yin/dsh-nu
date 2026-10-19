Shell: Nushell only

Every shell call runs through Nushell as `nu --no-config-file -c "<command>"`. There is no bash or PowerShell fallback, so do not write bash/PowerShell syntax and do not hand work to another shell. If Nushell cannot be resolved, the bundle fails closed; it does not substitute another shell.

- One process per call: variables, aliases, and `cd` do not persist. Pass `workdir` instead of changing directory.
- Values are structured: pipelines pass tables and records. Use `where`, `select`, `get`, `each`, and `sort-by` instead of parsing text. Optional field access is `$rec.field?`.
- A raw list or table as the final value renders as a wide table. Serialize it deliberately: `to text` for line-oriented output, `to json` for structure.
- Redirect stdout with `o> f`, stderr with `e> f`, both with `o+e> f`; discard a stream with `e>| ignore` or `o+e>| ignore`; capture a record with `(do { cmd } | complete)`. Shell spellings never redirect: `2> f` and `2>&1` fail to parse, `cmd > out.txt` passes `>` and the path as arguments, and the preflight refuses a bare `>`/`<` in argument position; comparisons use the operator.
- Variables are `let x = ...` and `mut x = ...`; the environment is `$env.NAME` (optional read: `$env.NAME?`).
- Control flow is `if` / `for x in $xs { }` / `match`. `for` is for side effects and cannot be piped; build a list with `... | each {|x| ... }`.
- `echo` only produces a pipeline value; as a non-final statement it is discarded. Use `print` for output that must appear.
- External programs start with their name; prefix with `^` to force the external binary when a Nushell command has the same name (`^ls`).
- A project script that ships its own shell entrypoint runs directly: `./scripts/build.sh`, never `bash scripts/build.sh`. Add execute permission first when it has none, and use `nix develop -c ./scripts/build.sh` when it needs its development environment.
- Non-zero exits are reported as `[exit code: N]`; a failed call may carry one `Nushell hint (...)` line naming the fix. Read it before retrying the same shape.
- Do not wait with a fixed `sleep` or by following a stream (`tail -f`, `watch`). Start long work as a background job and wait for its completion or job output; a retry backoff is at most 5 seconds.
- Do not locate a process with `ps | grep`, which filters the table's rendered text rather than process names; use `ps | where name =~ 'pattern'`. Capture the job handle or PID when the process starts.
- A filter must not hide a producer failure: capture the exit status with `| complete` before reporting success.
