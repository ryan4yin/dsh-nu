Shell: Nushell only

Every shell call runs as `nu --no-config-file -c "<command>"`, one fresh process per call; there is no bash or PowerShell fallback. Write Nushell, and never hand work to another shell (`bash -c`, `sh -c`, `pwsh`).

- Bash and PowerShell syntax is refused before the command runs, and the refusal names the Nushell spelling. A failed call may end with one `Nushell hint (...)` line; read it before retrying the same shape.
- A project script with its own shell entrypoint runs directly: `./scripts/build.sh` (add execute permission first; `nix develop -c ./scripts/build.sh` for its dev environment), never `bash scripts/build.sh`.
