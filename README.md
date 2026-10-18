# dsh-nu

English | [中文](docs/zh/README.md)

dsh-nu is a DeepSeek Harness bundle that makes Nushell the only shell a coding agent can use. It also teaches the model to write Nushell instead of bash or PowerShell.

Every shell call runs as one isolated process:

```text
nu --no-config-file -c "<command>"
```

The bundle registers the single `ctx.shell` provider, replaces the model-facing shell tool descriptions with Nushell ones, and adds a short rules section and a syntax guide to the system prompt. A command that hands work to another shell is rejected before a process starts. Bash and PowerShell habits are refused locally, with the Nushell spelling to use instead.

## Status

0.1.0 is published on npm. dsh `0.2.1-rc.2` and Nushell `0.115.1` are the tested pair, recorded in `package.json` under `testedWith`.

## Compatibility

dsh-nu supports only that pair. The peer ranges cover the dsh family, and boot logs a warning if the installed dsh or Nushell differs. Other versions have not been tested.

## Install

Requires dsh `0.2.1-rc.2` and Nushell `0.115.1` on `PATH`.

Add the bundle to a dsh profile:

```sh
dsh plugin --profile tui add dsh-nu@0.1.0
```

Use `--profile web` for the browser app. The first `dsh plugin` call creates the profile; the bundle's patch disables the platform shell executors and mounts the Nushell executor and teaching layer. Start the profile with `dsh tui` (or `dsh web`).

## Development

The repository ships a flake with the tested Node and Nushell versions:

```sh
nix develop
```

Inside the shell, or with your own Node 24 and Nushell 0.115.1:

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
```

`dev/link-peers.mjs` links the dsh peer packages into `node_modules`, so the tests can drive the real seams without publishing.

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

Sandbox budgets (`cwd`, `timeoutMs`, …) stay on the `nushell-executor` row, not in dsh's shared `shell` settings namespace. Override any row by id in the profile's own `cordis.patch.yml`. `examples/preset-nu-shell.md` lists the preset-level shell bypasses to disable.

## What "only Nushell" does not cover

- A preset row that spawns its own shell, such as a custom plugin calling `ctx.subprocess.spawn` directly or a PTY persistent-shell group. Disable it for a Nu-only deployment; see `examples/preset-nu-shell.md`.
- A shell named inside a quoted argument. That is data, not a command position. The guard rejects handoffs in command position and in wrapper chains; it is not a sandbox.
- Other shell seams. Hook bridges, persistent terminals, and tmux context use their own services or scripts and are outside this bundle. Keep them off for a strict deployment.
- dsh-nu does not change sandbox behaviour: `danger-full-access` runs directly, and confined modes wrap the Nushell argv through `ctx.sandbox.confine()` with the same `mode` / `denied` / `enforcement` reporting.

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
