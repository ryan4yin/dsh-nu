# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- `foreignShellAllowlist` entries now match the whole command, as documented:
  each pattern is anchored at both ends, so an exempt fragment no longer
  exempts a longer command that contains it. A prefix pattern such as
  `^bash -c` must now spell the whole command, for example `bash -c .*`.

## 0.4.0 (2026-10-19)

### Added

- The preflight reads Nushell's own parser instead of a second lexer:
  `nu --ide-ast` supplies the flat token stream and `nu --ide-check` the parser
  diagnostics, both over a private temporary script. The two probes run
  concurrently and a small LRU cache absorbs repeated commands.
- The guard now follows handoffs through blocks, subexpressions, interpolated
  strings, `env -S` / `--split-string`, launcher chains (`exec`, `taskset`,
  `flock`), `run-external`, raw-string arguments, attached `nu -c` /
  `--commands=` scripts, and literal `nu -c` scripts to depth 4. Quoted strings
  in command position and launcher arguments are data and are no longer
  refused.
- Parser contract tests (`test/ast.test.ts`) and a Linux-only PATH-shim fuzz
  test (`test/fuzz.test.ts`) that fails if the preflight lets a foreign shell
  run.
- `GLOSSARY.md` and ADR 0004 record the vocabulary and the parser decision.

### Changed

- The guard and syntax rules are async; a cold preflight costs about 14–16 ms
  per shell call, and a cache hit costs about 0 ms.
- The preflight fails closed when the probes cannot run. Boot runs a token and
  diagnostic canary when `verifyNu` is on and a check is enabled; the error
  names `enforceNushellOnly: false` and `syntaxLint: false` as the escape
  hatches.
- Syntax rules map stable parser diagnostics to the existing rule ids; forms
  Nushell accepts but silently misreads are still caught from the token stream.
  A bare `>`/`<` in argument position is refused regardless of the target; AST
  operators keep comparisons such as `where size > 1kb` allowed.

### Removed

- The hand-written quote/comment blanking pass, statement splitting, and the
  regex lexers that approximated Nushell's grammar.

### Fixed

- A `$'…'` escape could hide a handoff, `print hi > 1.txt` was accepted even
  though Nushell writes nothing, and a quoted string in command position was
  refused.
- A user-defined name masked a path-qualified shell: `def sh …; /bin/sh` is
  refused again.
- Commands containing non-ASCII text no longer lose tokens or report wrong
  fragments because the parser reports UTF-8 byte offsets.

## 0.3.3 (2026-10-19)

### Added

- CI builds `.#checks.x86_64-linux.package` on every push, the same call a
  consumer makes, so a stale hash or a dsh layout change fails there instead of
  on a user's machine. The flake gains a `nur-ryan4yin` input for that check
  only; consumers still pass their own dsh.

### Fixed

- The Nix package's `npmDepsHash` now matches the 0.3.2 lockfile, so a consumer
  build succeeds again.

## 0.3.2 (2026-10-19)

### Added

- The flake builds the plugin from this checkout, so a Nix consumer pins the
  repository instead of waiting for a release tarball or a copy in another
  repository. `lib.mkDshNuPackage` takes the dsh installation the bundle plugs
  into, renders `cordis.patch.yml` against it, and works with the dsh from
  `nur-ryan4yin`, which the complete README example uses, or `llm-agents.nix`.

### Fixed

- Four dev dependencies in the lockfile had no resolved URL or integrity hash,
  which broke an offline `npm ci`, such as the one the Nix build runs.

## 0.3.1 (2026-10-19)

### Added

- The guides and the shell-tool description name the bash idioms that trigger
  most refusals (`2>/dev/null`, `2>&1`, `cmd > file`, `&&`, `mkdir -p`,
  `ls -R`, `$env:VAR`, bare assignment) and give each Nushell rewrite, so a
  model can avoid a refusal instead of learning it from a failed call.
- The guard follows interpolation subexpressions and every command position
  inside blocks and subexpressions, so `do { bash -c … }` and `$"(sh -c …)"`
  are refused before a process starts.

### Changed

- The README configuration example uses the bundle's row ids (`nu-executor`,
  `nu-teaching`) and documents the teaching `timeoutMs` and `toolNames` fields.
  It also lists pnpm in the install requirements and says `guide: off` keeps
  the always-on rules.
- CI runs the platform matrix when a guide changes, and the release job
  publishes to npm before creating the GitHub release, so a release never
  points at a version npm does not serve.

### Fixed

- The syntax preflight no longer refuses valid Nushell: per-command env
  prefixes (`FOO=1 cmd`), `=~` comparisons, match-arm bindings, `^program`
  calls, datetime comparison targets, list commas, and multiline data or
  closure parameters. A `#` inside a word no longer starts a comment.
- The preflight refuses path-like stdin redirects (`<`, `<<`, `<<<`) and the
  remaining stderr spellings Nushell lexes as words, while a bare `>` is
  accepted as a comparison.
- Every confined call works on Windows: the executor accepts the shell spec the
  parent passes. A hint now appears only for a failing, non-denied exit, and
  boot fails when the Nushell probe prints no version.
- Nu shell calls keep the platform's 60 s timeout; disabling the bash sandbox
  row no longer drops it to 120 s.
- The PTC `tools:sdk` text no longer claims bash semantics for parameter
  expansion, `$env:` syntax, variable case, or pwsh sandbox modes. The guides
  correct the `path join`, `path exists`, `str replace`, redirect, and
  `ps | grep` examples, and the docs correct the stdin-redirect, prefix
  assignment, interpolation, hint, dotfile, and datetime claims.
- The integration probe matches the current denial and PTC behavior, and the
  developer probe profile resolves to the checkout instead of its own
  directory.
- The eval judge prompt no longer includes the arm name, and the published
  tarball now ships `docs/` and `eval/README.md`.
- The lockfile no longer records 16 linked dsh peers under `/nix/store`, which
  broke `npm ci` outside that store.

## 0.3.0 (2026-10-18)

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
