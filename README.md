# dsh-nu

English | [中文](docs/zh/README.md)

A DeepSeek Harness bundle that makes **Nushell the only shell** a coding agent can use, and teaches the model to write Nushell instead of bash or PowerShell.

Every shell call runs as one isolated process:

```text
nu --no-config-file -c "<command>"
```

The bundle registers the single `ctx.shell` provider, replaces the model-facing shell tool descriptions with Nushell ones, and adds a short rules section plus a syntax guide to the system prompt. Commands that hand work to another shell are rejected before a process exists, and bash/PowerShell habits get a local failure with the Nushell spelling.

## Status

Pre-release. The supported pair is dsh `0.2.1-rc.2` and Nushell `0.115.1`, recorded in `package.json` under `testedWith`.

## Compatibility

The tested pair is dsh `0.2.1-rc.2` and Nushell `0.115.1`. The package peer
ranges pin the dsh family, and boot logs a warning when the installed Nushell or
dsh differs from that pair. Other versions are untested rather than known broken.

## Install

This package is distributed through npm. Keep the repository private and install from a release tarball or a local checkout until the first public release.

## Development

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` links the dsh peer packages into `node_modules` so the test suite can drive the real seams without publishing.

The suite runs on Node 24. The package allows Node 22.19 and newer, but versions other than 24 are untested.

## Configuration

```yaml
- id: nushell-executor
  name: dsh-nu/executor
  config:
    nuPath: ""
    nuArgs: ["--no-config-file", "-c"]
    enforceNushellOnly: true
    dialectLint: true
    dialectHints: true
    requireNu: true
    verifyNu: true
    foreignShellAllowlist: []

- id: nushell-teaching
  name: dsh-nu/teaching
  config:
    guide: full          # full | compact | off
    rules: true
    rewriteToolDescriptions: true
```

| Field | Default | Meaning |
|---|---|---|
| `nuPath` | `$DSH_NU_PATH`, then `nu` | Nushell executable: field, then environment, then PATH |
| `nuArgs` | `["--no-config-file","-c"]` | Argv prefix; the command is appended last |
| `enforceNushellOnly` | `true` | Refuse handing the command to another shell |
| `foreignShellAllowlist` | `[]` | Whole-command regexes exempt from the guard and the dialect lint |
| `dialectLint` | `true` | Refuse bash/PowerShell habits before spawning |
| `dialectHints` | `true` | Append one `Nushell hint (…)` line to a failed call |
| `guide` | `full` | Prompt guide: `full`, `compact`, or `off` |
| `rules` | `true` | Prepend the shell-rules section |
| `rewriteToolDescriptions` | `true` | Rewrite the `bash` / `pwsh` tool descriptions |
| `requireNu` / `verifyNu` | `true` / `true` | Fail boot when `nu` cannot be resolved or fails its `--version` probe |
| `verifyTimeoutMs` | `10000` | Bound for that probe |

Sandbox budgets (`cwd`, `timeoutMs`, …) stay on the `nushell-executor` row, not in
dsh's shared `shell` settings namespace. Override any row by id in the profile's
own `cordis.patch.yml`. `examples/preset-nu-shell.md` lists the preset-level
shell bypasses to disable.

## What "only Nushell" does not cover

- **Preset rows that spawn their own shell**: a custom plugin that calls
  `ctx.subprocess.spawn` directly, or a PTY persistent-shell group. Disable
  them for a Nu-only deployment; see `examples/preset-nu-shell.md`.
- **Quoted handoffs**: a shell named inside a quoted argument is data, not a
  command position. The guard rejects handoffs in command position and in
  wrapper chains; it is not a sandbox.
- **Other shell seams**: hook bridges, persistent terminals, and tmux context
  use their own services or scripts and are outside this bundle. Keep them off
  for a strict deployment.
- **Sandboxing is unchanged**: `danger-full-access` runs directly, and confined
  modes wrap the Nushell argv through `ctx.sandbox.confine()` with the same
  `mode` / `denied` / `enforcement` reporting.

## Documentation

- [Why a Nushell-only shell](docs/why.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Verification](docs/verification.md)
- [Nushell friction review](docs/nushell-friction-review.md)
- [Distribution and support (ADR)](docs/adr/0001-distribution-and-support.md)

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

The Nushell-only shell, guard, and teaching ideas in this project come from
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only) (MIT),
the original implementation of those ideas.

Thanks to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) project for the
shell seam this bundle extends.
