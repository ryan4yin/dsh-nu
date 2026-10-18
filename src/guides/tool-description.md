Execute a Nushell command. This deployment runs every command through Nushell (nu --no-config-file -c); bash and PowerShell are never spawned. The dialect is Nushell, not bash or PowerShell. If Nushell cannot be resolved, this bundle fails closed.

Provide `description` before `command`: a clear, concise description of what the command does in active voice, 5-10 words, shown to the user.
The `command` argument is Nushell syntax. Each call is a fresh process, so state does not persist.

Budgets and behavior mirror the host tool: default timeout, per-call timeout override, output byte cap with spill-on-overflow, background execution, and the current working directory apply unchanged.

A command that hands work to another shell is refused before it runs, and so is bash/PowerShell syntax (`2>&1`, `cmd > file`, `&&`/`||`, `$?`, `$env:NAME`, bash flags on Nushell builtins); the error names the Nushell spelling to use. A failing command may carry one `Nushell hint (...)` line on stderr; read it before retrying.
Long work belongs in a background call: wait for its job output instead of a fixed `sleep`, and do not follow a stream with `tail -f` or find a process with `ps | grep`.

When you need output, let the final pipeline value stand, or put `print` last: it returns nothing, so a pipeline after it has no input. Serialize a model-facing result with `to text` for lines or `to json` for structure; a raw table is token-heavy. A failing command is reported as `[exit code: N]`.
