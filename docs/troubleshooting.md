# Troubleshooting

English | [中文](zh/troubleshooting.md)

## Boot fails: cannot resolve nu

The executor fails closed when `requireNu` is true and the executable cannot
be resolved. Install Nushell, put `nu` on `PATH`, or set `nuPath` in the
plugin config / `DSH_NU_PATH` in the environment. `requireNu: false` boots
anyway and leaves every shell call failing until the executable exists.

## Boot warns: Nushell version differs

The bundle warns when `nu --version` is not the pinned Nushell version. The
dialect rules, hints, and guide are tuned to the pinned version, so commands the
model is told to write may not match. Install the pinned version, or accept the
warning and verify the failing behaviour yourself.

## Refused: foreign shell

The error names the shell and quotes the statement, for example `bash -c` or
`pwsh -Command`, including launchers such as `env`, `xargs`, or `sudo`. Rewrite
the call in Nushell. If the call site is genuinely required, add a whole-command
regular expression to `foreignShellAllowlist`; do not disable the guard for the
whole deployment.

## Refused: bash or PowerShell habit

The refusal names the fragment and the Nushell spelling: numbered redirection,
`$env:NAME`, bare assignment, `foreach`, PowerShell cmdlets, `&&` / `||`,
`$?`, or an unknown flag on a Nushell builtin. Fix the fragment; quoting it
turns it into data. If the preflight is wrong for one call site, allowlist that
command or set `dialectLint: false`.

## A failure carries a Nushell hint

The hint line is appended after the command's own stderr and starts with
`Nushell hint (<id>):`. It describes one fix for the error Nushell reported; if
the command was refused before spawning, there is no hint because Nushell never
ran.

## Writes fail: read-only or permission denied

This is a filesystem or sandbox policy issue, not a Nushell syntax issue. Check
the sandbox mode for the session and write inside the workspace or the backend's
permitted temp area. Do not retry the same write through another tool.

## Tests cannot find @deepseek-ai packages

The dsh packages are peers. Run `npm install`, then
`node dev/link-peers.mjs --root <dsh-install-root>`. The helper accepts a
flat dsh package scope or the scope nested under the dsh package, and refuses to
relink a scope onto itself.

## CI runs only for pull requests

CI is the milestone gate: a pull request runs the Linux, macOS, and Windows
matrix once. For the fast loop run `npm run typecheck`, `npm test`, and
`npm run build` locally; see `docs/verification.md`.
