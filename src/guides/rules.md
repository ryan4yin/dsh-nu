Shell: Nushell only

Every shell call runs through Nushell as `nu --no-config-file -c "<command>"`. There is no bash or PowerShell fallback, so do not write bash/PowerShell syntax and do not hand work to another shell. If Nushell cannot be resolved, the bundle fails closed; it does not substitute another shell.

- One process per call: variables, aliases, and `cd` do not persist. Pass `workdir` instead of changing directory.
- Prefer the native read, grep, glob, write, and edit tools; use the shell forms below only when the work is already inside a shell command.
- Values are structured: pipelines pass tables and records. Use `where`, `select`, `get`, `each`, and `sort-by` instead of parsing text. Optional field access is `$rec.field?`.
- A raw list or table as the final value renders as a wide table. Serialize it deliberately: `to text` for line-oriented output, `to json` for structure.
- Redirect stdout with `o> f`, stderr with `e> f`, both with `o+e> f`; discard a stream with `e>| ignore` or `o+e>| ignore`; capture a record with `(do { cmd } | complete)`.
- Variables are `let x = ...` and `mut x = ...`; the environment is `$env.NAME` (optional read: `$env.NAME?`).
- Control flow is `if` / `for x in $xs { }` / `match`. `for` is for side effects and cannot be piped; build a list with `... | each {|x| ... }`.
- `echo` only produces a pipeline value; as a non-final statement it is discarded. Use `print` for output that must appear.
- External programs start with their name; prefix with `^` to force the external binary when a Nushell command has the same name (`^ls`).
- Non-zero exits are reported as `[exit code: N]`; a failed call may carry one `Nushell hint (...)` line naming the fix. Read it before retrying the same shape.
- Do not wait with a fixed `sleep` or by following a stream (`tail -f`, `watch`). Start long work as a background job and wait for its completion or job output; a retry backoff is at most 5 seconds.
- Do not locate a process with `ps | grep`; it matches the grep itself. Capture the job handle or PID when the process starts.
- A filter must not hide a producer failure: capture the exit status with `| complete` before reporting success.
