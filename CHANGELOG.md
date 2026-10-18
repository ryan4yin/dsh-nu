# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- The syntax preflight refuses shell-style stdout redirects (`cmd > out.txt`) and
  numbered stderr spellings Nushell lexes as words (`2>/dev/null`, `2>nul`,
  `2>$null`, `2>> file`, `&>`, `1> file`). Nushell exits 0 for those without
  redirecting anything, so the refusal names `o>`, `e>`, `o+e>`, `e>| ignore`,
  or `(do { cmd } | complete)`.
- The always-on rules and the shell-tool description name the refused shell forms,
  so a model can write `o>` / `e>` instead of learning the refusal from a failed
  call.

### Changed

- Renamed the dialect layer to syntax preflight. Config keys `dialectLint` /
  `dialectHints` are now `syntaxLint` / `syntaxHints`; the module path
  `dsh-nu/dialect` is now `dsh-nu/syntax`, and the exported functions
  `assertNuDialect` / `findHabit` are now `assertNushellSyntax` /
  `findSyntaxIssue`. No compatibility aliases are kept. The release that
  includes this rename will be 0.3.0.

## 0.2.1 (2026-10-18)

### Changed

- The guides ask for model-facing output to be serialized with `to text` or
  `to json` instead of a wide table. They also state that the bundle fails closed
  when Nushell cannot be resolved.
- The README intros and `cordis.patch.yml` state that the model keeps calling
  the same `bash` / `pwsh` tool while each command runs as `nu`, and that dsh's
  sandbox is untouched. The disabled `bash-sandbox` / `pwsh-sandbox` rows are
  shell executors, not the sandbox itself.

### Fixed

- Corrected the full guide's quoting rule: single quotes are literal, double
  quotes process escapes, and only `$"..."` interpolates.
- The guard now refuses a foreign-shell handoff nested in a block or a
  subexpression (`do { bash -c … }`, `let x = (sh -c …)`), while leaving
  closure parameters (`{ |sh| … }`), record keys, names the command defines
  itself, and a `command -v bash` query alone.
- A denied Nushell file effect under confinement now keeps its sandbox facts:
  the executor adds Nushell's `read-only_filesystem_or_storage_medium` denial
  signature to the confinement signatures, so `sandbox.denied` is true and background
  settlement classifies it too.

## 0.2.0 (2026-10-18)

### Added

- A real-model teaching eval harness with full, compact, and off arms, task
  fixtures, guard-aware scoring, cross-model judging, and dated reports. It
  includes wait/background cases and tracks long sleeps and blocking shapes.

### Changed

- The system-prompt guide now calls out the traps between `echo` and `print`,
  `for` and `each`, optional record access, and discarding streams with
  `e>| ignore`. Each claim has a real-Nushell assertion. It also rejects fixed
  sleeps as completion waits, stream-follow waits, and `ps | grep` process
  lookups.
- Model-facing prose now lives as Markdown under `src/guides/`; the build copies
  it to `dist/guides`, so the published package is unchanged at runtime.

## 0.1.0 (2026-10-18)

First release of `dsh-nu`, a clean-room implementation of the Nushell-only shell
bundle for DeepSeek Harness.

### Added

- A single `ctx.shell` provider that runs every command as
  `nu --no-config-file -c "<command>"`. It reuses the first-party sandbox
  executor's timeouts, output caps, spill files, background handles, and denial
  reporting.
- A guard that refuses handing a command to another shell before a process
  exists, with an allowlist for deliberate exceptions.
- A syntax preflight that refuses bash and PowerShell syntax before spawning
  and names the Nushell spelling. A hint line covers failures that reach
  Nushell.
- Teaching for the system prompt, the model-facing shell tool descriptions, and
  the generated PTC `tools:sdk` declarations.
- A `cordis.patch.yml` bundle patch that disables the platform shell executors
  and mounts `dsh-nu/executor` plus `dsh-nu/teaching`.
- English documentation with Chinese mirrors under `docs/zh/`.

### Verification

- Real `nu` differential tests for every syntax-preflight rule, and real failure samples
  for every hint class.
- Executable claims tests for the guide's statements about Nushell.
- A real dsh boot probe that runs native and PTC compositions and checks the
  shell seam, refusals, hints, prompt sections, tool description, and SDK text.
- A manifest contract test for the tested pair, peer ranges, exports, and the
  published file list.
- CI runs the unit suite on Linux, macOS, and Windows, and the real boot on
  Linux.
