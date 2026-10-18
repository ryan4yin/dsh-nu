# dsh-nu

English | [中文](docs/zh/README.md)

dsh-nu forces DeepSeek Harness to run every shell command in Nushell, with the `bash` / `pwsh` executors disabled. It does three things:

- **Swap the executor**: Through the low-level extension point DeepSeek Harness exposes, it replaces the `bash` / `pwsh` executor with a Nushell executor at runtime (commands run as `nu --no-config-file -c "<command>"`). dsh still sees the same `bash` / `pwsh` tool with the same calling convention, so the Nushell executor plugs into dsh and stays compatible with every other plugin and feature. The oddity is cosmetic: the model calls a tool named `bash` / `pwsh` and passes it Nushell script.
- **Teach the model**: It adds a short Nushell rules section and syntax guide to the system prompt. That teaching text costs some context but matters: with it turned off, the model hits frequent errors when calling the shell tool.
- **Refuse handoffs**: When a Nushell command hands work to another shell, the guard refuses it before a process starts; bash and PowerShell syntax is refused the same way by the syntax preflight, with the Nushell spelling in the error.

## Status

0.3.0 is published on npm. dsh `0.2.1-rc.2` and Nushell `0.115.1` are the tested pair, recorded in `package.json` under `testedWith`.

## Compatibility

dsh-nu supports only that pair. The peer ranges cover the dsh family, and boot logs a warning if the installed dsh or Nushell differs. Other versions have not been tested.

## Install

Requires dsh `0.2.1-rc.2` and Nushell `0.115.1` on `PATH`.

Add the bundle to a dsh profile:

```sh
dsh plugin --profile tui add dsh-nu@0.3.0
```

Use `--profile web` for the browser app. The first `dsh plugin` call creates the profile; the bundle's patch disables the platform shell executors and mounts the Nushell executor and teaching layer. Start the profile with `dsh tui` (or `dsh web`).

If pnpm reports `ERR_PNPM_NO_MATURE_MATCHING_VERSION` for a fresh release, it is applying `minimumReleaseAge`. Wait for the cutoff, or add `--config.minimumReleaseAge=0` to the same command.

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

Real-model teaching evals are separate from `npm test`; see [`eval/README.md`](./eval/README.md) for the three-arm harness, cross-model judging, and the dated results.

## Configuration

The bundle's patch mounts one executor row and one teaching row; a profile patch overrides either by id. This profile patch spells out every field and its default:

```yaml
- id: nu-executor
  name: dsh-nu/executor
  config:
    nuPath: ""
    nuArgs: ["--no-config-file", "-c"]
    enforceNushellOnly: true
    syntaxLint: true
    syntaxHints: true
    requireNu: true
    verifyNu: true
    verifyTimeoutMs: 10000
    foreignShellAllowlist: []

- id: nu-teaching
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
| `foreignShellAllowlist` | `[]` | Whole-command regexes exempt from the guard and the syntax preflight |
| `syntaxLint` | `true` | Refuse bash/PowerShell syntax before spawning |
| `syntaxHints` | `true` | Append one `Nushell hint (…)` line to a failed call |
| `guide` | `full` | Prompt guide: `full`, `compact`, or `off` |
| `rules` | `true` | Prepend the shell-rules section |
| `rewriteToolDescriptions` | `true` | Rewrite the `bash` / `pwsh` tool descriptions |
| `requireNu` / `verifyNu` | `true` / `true` | Fail boot when `nu` cannot be resolved or fails its `--version` probe |
| `verifyTimeoutMs` | `10000` | Bound for that probe |

Choose the guide by goal:

- `off` is a diagnostic baseline only. It removes the rules and guide, and the eval recorded many preflight refusals and extra retries; do not use it in normal sessions.
- `compact` covers the common idioms and uses fewer prompt tokens. It handled most eval samples without a refusal.
- `full` keeps the detailed syntax reference for uncommon syntax and edge cases.

Sandbox budgets (`cwd`, `timeoutMs`, …) stay on the `nu-executor` row, not in dsh's shared `shell` settings namespace. Override any row by id in the profile's own `cordis.patch.yml`. `examples/preset-nu-shell.md` lists the preset-level shell bypasses to disable.

## What "only Nushell" does not cover

- A preset row that spawns its own shell, such as a custom plugin calling `ctx.subprocess.spawn` directly or a PTY persistent-shell group. Disable it for a Nu-only deployment; see `examples/preset-nu-shell.md`.
- A shell named inside a plain quoted string. That is data, not a command position. `$"…"` and `$'…'` interpolate, so the guard and the preflight scan each parenthesized part as code. The guard rejects handoffs in command position and in wrapper chains; it is not a sandbox.
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
