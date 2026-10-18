Execute a Nushell command. This deployment runs every command through Nushell (nu --no-config-file -c); bash and PowerShell are never spawned. If Nushell cannot be resolved, this bundle fails closed.

Provide `description` before `command`: a clear, concise description of what the command does in active voice, 5-10 words, shown to the user.

The `command` argument is Nushell syntax. Each call is a fresh process, so state does not persist.

Budgets and behavior mirror the host tool: default timeout, per-call timeout override, output byte cap with spill-on-overflow, background execution, and the current working directory apply unchanged.

Bash/PowerShell syntax is refused before running and the error names the Nushell spelling; a failing command may carry one `Nushell hint (...)` line. Serialize model-facing output with `to text` for lines or `to json` for structure.

Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way. Before any delete or move, verify that the resolved absolute target path is the intended one; never run it against a computed path you have not checked.
