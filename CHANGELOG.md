# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- A real-model teaching eval harness with two arms, task fixtures, guard-aware
  scoring, cross-model judging, and a first-round report.

### Changed

- The system-prompt guide now calls out the traps between `echo` and `print`,
  `for` and `each`, optional record access, and discarding streams with
  `e>| ignore`. Each claim has a real-Nushell assertion.

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
