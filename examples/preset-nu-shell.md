# Mounting dsh-nu in a base-backed profile

A profile built on `@deepseek-ai/dsh-base` already mounts a platform shell
executor (bash on macOS/Linux, PowerShell on Windows). dsh-nu replaces that
executor, so the profile patch must do two things:

1. disable the platform executor rows;
2. mount `dsh-nu/executor` and `dsh-nu/teaching`.

The shell tool rows are left alone: they call `ctx.shell` and keep their
model-facing names, so saved sessions and prompt caches stay valid.

```yaml
# profile/cordis.patch.yml
- id: bash-sandbox
  disabled: true
- id: pwsh-sandbox
  disabled: true
- insert:
    - id: nu-executor
      name: dsh-nu/executor
      config:
        nuPath: ""          # or an absolute path when nu is not on PATH
        enforceNushellOnly: true
        syntaxLint: true
    - id: nu-teaching
      name: dsh-nu/teaching
      config:
        guide: full
```

## Preset-level shell bypasses

A preset can provide its own shell tool or its own exec path outside
`ctx.shell`. Disable those entries in the same patch; otherwise the model
can still reach bash through the preset:

```yaml
- id: preset-bash
  disabled: true
- id: preset-pwsh
  disabled: true
```

Replace the ids above with the preset's real entry ids (inspect them with
`dsh --profile <name> --dump-config`). dsh fails the profile when two shell
providers register the same service, so a missing disable is visible at boot.

## Configuration

| key | default | meaning |
|---|---|---|
| `nuPath` | `DSH_NU_PATH`, then `nu` on PATH | executable |
| `nuArgs` | `['--no-config-file', '-c']` | argv prefix; the command is appended |
| `enforceNushellOnly` | `true` | refuse commands that hand off to another shell |
| `foreignShellAllowlist` | `[]` | whole-command regexes exempt from both checks |
| `syntaxLint` | `true` | refuse bash/PowerShell syntax before spawning |
| `syntaxHints` | `true` | append one hint to a failed command's stderr |
| `requireNu` | `true` | fail boot when nu cannot be resolved |
| `verifyNu` | `true` | run `nu --version` once at boot |
| `verifyTimeoutMs` | `10000` | bound for that probe |
| `guide` (teaching) | `full` | `full`, `compact`, `off` |
| `rules` (teaching) | `true` | add the mandatory-rules prompt section |
| `rewriteToolDescriptions` (teaching) | `true` | rewrite shell tool descriptions and the PTC SDK section |
