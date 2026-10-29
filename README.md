# dsh-nu

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness) [![](https://img.shields.io/npm/v/dsh-nu.svg?style=flat-square)](https://www.npmjs.com/package/dsh-nu)

English | [中文](docs/zh/README.md)

dsh-nu forces DeepSeek Harness to run every shell command in Nushell, with the `bash` / `pwsh` executors disabled. It does three things:

- **Swap the executor**: Through the low-level extension point DeepSeek Harness exposes, it replaces the `bash` / `pwsh` executor with a Nushell executor at runtime (commands run as `nu --no-config-file -c "<command>"`). dsh still sees the same `bash` / `pwsh` tool with the same calling convention, so the Nushell executor plugs into dsh and stays compatible with every other plugin and feature. The oddity is cosmetic: the model calls a tool named `bash` / `pwsh` and passes it Nushell script.
- **Teach the model**: It adds a short Nushell rules section and syntax guide to the system prompt. That teaching text costs some context but matters: with it turned off, the model hits frequent errors when calling the shell tool.
- **Refuse handoffs**: When a Nushell command hands work to another shell, the guard refuses it before a process starts. Bash and PowerShell syntax that Nushell rejects or silently misreads is refused by the syntax rules, with the Nushell spelling in the error.

## Status

0.6.1 is published on npm. dsh `0.2.1-rc.2` and Nushell `0.116.1` are the tested pair, recorded in `package.json` under `testedWith`.

## Compatibility

dsh-nu supports only that pair. The peer ranges cover the dsh family, and boot logs a warning if the installed dsh or Nushell differs. Other versions have not been tested.

## Install

Requires Node 22.19+, `pnpm` on `PATH` (the `dsh plugin` installer runs it), dsh `0.2.1-rc.2`, and Nushell `0.116.1` on `PATH`.

Add the bundle to a dsh profile:

```sh
dsh plugin --profile tui add dsh-nu@0.6.1
```

Use `--profile web` for the browser app. The first `dsh plugin` call creates the profile; the bundle's patch disables the platform shell executors and mounts the Nushell executor and teaching layer. Start the profile with `dsh tui` (or `dsh web`).

If pnpm reports `ERR_PNPM_NO_MATURE_MATCHING_VERSION` for a fresh release, it is applying `minimumReleaseAge`. Wait for the cutoff, or add `--config.minimumReleaseAge=0` to the same command.

## Development

The repository ships a flake with the tested Node and Nushell versions:

```sh
nix develop
```

Inside the shell, or with your own Node 24 and Nushell 0.116.1:

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

## Nix

dsh-nu does not package dsh itself. This flake builds the plugin from the checkout, and the dsh installation comes from a flake that packages it. The complete example below uses `nur-ryan4yin`, whose `dsh` also provides the `withPlugins` wrapper that applies bundle patches:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # dsh itself, plus its withPlugins wrapper.
    nur-ryan4yin = {
      url = "github:ryan4yin/nur-packages";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # The bundle, built from this repository's flake. Its nixpkgs is not
    # followed: that pin supplies the tested Nushell.
    dsh-nu.url = "github:ryan4yin/dsh-nu";
  };

  outputs = { self, nixpkgs, nur-ryan4yin, dsh-nu }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};

      # dsh from nur-ryan4yin; withPlugins applies the bundle patch.
      dsh = nur-ryan4yin.packages.${system}.dsh;
      dshWithNu = dsh.withPlugins [
        (dsh-nu.lib.mkDshNuPackage { inherit pkgs dsh; })
      ];
    in {
      packages.${system}.default = dshWithNu;

      # Install `dshWithNu` wherever dsh would go, for example:
      #   environment.systemPackages = [ dshWithNu ];
      #   home.packages = [ dshWithNu ];
    };
}
```

`nix build` produces that `dsh` binary. `mkDshNuPackage` needs only the dsh installation's `@deepseek-ai` peer packages, so `llm-agents.nix`'s dsh works there too; applying the bundle still needs a wrapper that adds `--patch`, which `nur-ryan4yin`'s `withPlugins` provides. Bump the bundle with `nix flake update dsh-nu`.

## Configuration

The bundle's patch mounts one executor row and one teaching row; a profile patch overrides either by id. This profile patch spells out every field and its default:

```yaml
- id: nu-executor
  name: dsh-nu/executor
  config:
    nuPath: ""
    nuArgs: ["--no-config-file", "-c"]
    timeoutMs: 60000
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
    toolNames: ["bash", "pwsh"]
```

| Field | Default | Meaning |
|---|---|---|
| `nuPath` | `$DSH_NU_PATH`, then `nu` | Nushell executable: field, then environment, then PATH |
| `nuArgs` | `["--no-config-file","-c"]` | Argv prefix; the command is appended last, so it must end with `-c` or `--commands` |
| `enforceNushellOnly` | `true` | Refuse handing the command to another shell |
| `foreignShellAllowlist` | `[]` | Regexes exempt from both preflight checks; each must match the whole command |
| `syntaxLint` | `true` | Refuse bash/PowerShell syntax before spawning |
| `syntaxHints` | `true` | Append one `Nushell hint (…)` for a recognized failure or deprecation warning, including exit 0 |
| `guide` | `full` | Prompt guide: `full`, `compact`, or `off` |
| `rules` | `true` | Prepend the shell-rules section |
| `rewriteToolDescriptions` | `true` | Replace the shell claims in the `bash` / `pwsh` tool descriptions, keeping the host's own contract text |
| `toolNames` | `["bash","pwsh"]` | Tool schemas whose shell text is rewritten |
| `timeoutMs` | `60000` | Default per-call timeout; `maxTimeoutMs` caps overrides |
| `requireNu` / `verifyNu` | `true` / `true` | Fail boot when `nu` cannot be resolved, reports no version, or cannot run the preflight |
| `verifyTimeoutMs` | `10000` | Bound for that probe |

Both checks read Nushell's parser through two read-only probes on a private temporary script. Boot runs a token and diagnostic canary once when `verifyNu` is on and either check is enabled: with `requireNu` (the default) a failure fails boot, and with `requireNu: false` each call is refused instead of running without the check (fail closed). The error names `enforceNushellOnly: false` and `syntaxLint: false` as the escape hatches and points at the tested Nushell version.

Choose the guide by goal:

- `off` disables the guide only; the rules stay on unless `rules: false`. It is a diagnostic baseline: the eval recorded many preflight refusals and extra retries, so do not use it in normal sessions.
- `compact` covers the common idioms and uses fewer prompt tokens. It handled most eval samples without a refusal.
- `full` keeps the detailed syntax reference for uncommon syntax and edge cases.

Sandbox budgets (`cwd`, `timeoutMs`, …) stay on the `nu-executor` row, not in dsh's shared `shell` settings namespace. Override any row by id in the profile's own `cordis.patch.yml`. `examples/preset-nu-shell.md` lists the preset-level shell bypasses to disable.

## What "only Nushell" does not cover

The guard is not a sandbox: it checks command positions it can read, and everything else is out of reach.

- A shell name inside a plain quoted string is data, not a command position: `'bash -c "echo hi"'` evaluates to a string, it does not run bash. `$"…"` and `$'…'` interpolate, so each parenthesized expression inside one is inspected as code; quoted text inside it stays data.
- A literal `nu -c '<script>'` or `nu -e '<script>'` is inspected recursively, up to four levels. A script value built at run time is not inspected.
- A Nushell script file is not read: `nu script.nu`, `source`, and `use` load code the guard never sees, so a handoff written into a file and run that way is out of reach.
- A shell name computed at run time, or a program that starts a shell itself (a language runtime, an editor), is out of reach. The guard follows literal shell names, a fixed launcher table (including `nix shell` / `nix develop --command` and `nix run`), `run-external`, and literal `nu -c` scripts.
- A tool that runs its own argument text is out of scope on purpose: `hyperfine`, `watch`, `make`, `npm run`, and `git` hooks are not shell handoffs, so the guard allows them even though they may start `sh` internally. Refusing them would break the tools rather than keep the deployment Nu-only. When the command you pass to one of them is Nushell, name the shell: `hyperfine -S nu 'ls | length'`, `hyperfine -N 'rg foo'` (no shell at all), or `watch -x rg foo`. Nushell cannot be the shell `watch` starts by itself, so `watch 'a && b'` runs bash, not Nushell.
- A preset row that spawns its own shell, such as a custom plugin calling `ctx.subprocess.spawn` directly or a PTY persistent-shell group. Disable it for a Nu-only deployment; see `examples/preset-nu-shell.md`.
- Other shell seams. Hook bridges, persistent terminals, and tmux context use their own services or scripts and are outside this bundle. Keep them off for a strict deployment.
- dsh-nu does not change sandbox behaviour: `danger-full-access` runs directly, and confined modes wrap the Nushell argv through `ctx.sandbox.confine()` with the same `mode` / `denied` / `enforcement` reporting.
- The preflight's parser probes (`nu --ide-ast` and `nu --ide-check`) run outside the sandbox, before the command. They parse the command without running it, but a file named by `source` or `use` is read from disk to be parsed; its contents are not returned to the model.

## Documentation

- [Why a Nushell-only shell](docs/why.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Verification](docs/verification.md)
- [Nushell friction review](docs/nushell-friction-review.md)
- [Distribution and support (ADR)](docs/adr/0001-distribution-and-support.md)
- [Parser-based preflight (ADR)](docs/adr/0004-ast-based-preflight.md)
- [Glossary](GLOSSARY.md)

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgements

The Nushell-only shell, guard, and teaching ideas in this project come from
[YMRwithNoworry/dsh-nushell-only](https://github.com/YMRwithNoworry/dsh-nushell-only) (MIT),
the original implementation of those ideas.

Thanks to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) project for the
shell seam this bundle extends.
