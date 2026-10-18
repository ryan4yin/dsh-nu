# Troubleshooting

English | [中文](zh/troubleshooting.md)

## Boot fails: nu cannot be resolved

The executor fails closed when `requireNu` is true and it cannot find the executable. Install Nushell, put `nu` on `PATH`, or set `nuPath` in the plugin config or `DSH_NU_PATH` in the environment. With `requireNu: false` the bundle still boots, but every shell call fails until the executable exists.

## Boot warns: Nushell version differs

The bundle warns when `nu --version` does not match the pinned Nushell version. The dialect rules, hints, and guide are tuned to that version, so commands the model is told to write may not behave the same. Install the pinned version, or accept the warning and check the failing behaviour yourself.

## Refused: foreign shell

The error names the shell and quotes the statement, for example `bash -c` or `pwsh -Command`. Launchers such as `env`, `xargs`, or `sudo` are included. Rewrite the call in Nushell. If the call site really needs an exception, add a whole-command regular expression to `foreignShellAllowlist` instead of turning the guard off for the deployment.

## Refused: bash or PowerShell habit

The refusal names the fragment and the Nushell spelling to use: numbered redirection, `$env:NAME`, bare assignment, `foreach`, PowerShell cmdlets, `&&` / `||`, `$?`, or an unknown flag on a Nushell builtin. Fix the fragment; quoting it turns it into data. If the preflight is wrong for one call site, allowlist that command or set `dialectLint: false`.

## A failure carries a Nushell hint

The hint line comes after the command's own stderr and starts with `Nushell hint (<id>):`. It gives one fix for the error Nushell reported. A command refused before spawning has no hint, because Nushell never ran.

## Writes fail: read-only or permission denied

This is a filesystem or sandbox policy problem, not a Nushell syntax problem. Check the sandbox mode for the session and write inside the workspace or the backend's permitted temp area. Do not retry the same write through another tool.

## Tests cannot find @deepseek-ai packages

The dsh packages are peers. Run `npm install`, then
`node dev/link-peers.mjs --root <dsh-install-root>`. The helper accepts a flat dsh package scope or the scope nested under the dsh package, and it will not relink a scope onto itself.

## CI runs only for pull requests

CI is the milestone gate: a code pull request runs the Linux, macOS, and Windows matrix once, and a docs-only pull request runs the Docs workflow. For the fast loop, run `npm run typecheck`, `npm test`, and `npm run build` locally. See `docs/verification.md`.
