# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- The guides ask for model-facing output to be serialized with `to text` or
  `to json` instead of a wide table. They also state that the bundle fails closed
  when Nushell cannot be resolved.

### Fixed

- Corrected the full guide's quoting rule: single quotes are literal, double
  quotes process escapes, and only `$"..."` interpolates.
- The guard now refuses a foreign-shell handoff nested in a block or a
  subexpression (`do { bash -c … }`, `let x = (sh -c …)`), while leaving
  closure parameters (`{ |sh| … }`), record keys, names the command defines
  itself, and a `command -v bash` query alone.
- A denied Nushell file effect under confinement now keeps its sandbox facts:
  the executor adds Nushell's `read-only_filesystem_or_storage_medium` dialect
  to the confinement signatures, so `sandbox.denied` is true and background
  settlement classifies it too.

### Changed

- The README, its Chinese translation, and `cordis.patch.yml` state that the
  bundle reuses dsh's sandbox. The disabled `bash-sandbox` / `pwsh-sandbox`
  rows are shell executors, not the sandbox itself.

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
- A dialect preflight that refuses bash and PowerShell habits before spawning
  and names the Nushell spelling. A hint line covers failures that reach
  Nushell.
- Teaching for the system prompt, the model-facing shell tool descriptions, and
  the generated PTC `tools:sdk` declarations.
- A `cordis.patch.yml` bundle patch that disables the platform shell executors
  and mounts `dsh-nu/executor` plus `dsh-nu/teaching`.
- English documentation with Chinese mirrors under `docs/zh/`.

### Verification

- Real `nu` differential tests for every dialect rule, and real failure samples
  for every hint class.
- Executable claims tests for the guide's statements about Nushell.
- A real dsh boot probe that runs native and PTC compositions and checks the
  shell seam, refusals, hints, prompt sections, tool description, and SDK text.
- A manifest contract test for the tested pair, peer ranges, exports, and the
  published file list.
- CI runs the unit suite on Linux, macOS, and Windows, and the real boot on
  Linux.
