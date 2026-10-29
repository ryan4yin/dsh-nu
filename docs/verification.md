# Verification

English | [中文](zh/verification.md)

## What the suite covers

`npm test` covers:

- unit tests for executable resolution, argv assembly, the guard, the syntax rules, the teaching rewrites, the executor seam, boot probing, confinement, and inherited budgets;
- parser contract tests. The preflight depends on the exact output of `nu --ide-ast` and `nu --ide-check`: a flat token list with shape, content, and span, plus JSONL diagnostics. The contract tests pin the shapes, offsets, and fields the preflight reads, so a change in Nushell's IDE output fails the suite instead of quietly loosening the guard;
- a differential corpus. Every refused syntax form runs against the pinned Nushell and must fail, except the forms Nushell accepts silently, which are pinned separately by running them and asserting their real exit-0 behaviour. Every allowed form must run. Handoff cases assert the guard's answer, including nested blocks, closures, interpolations, wrapper chains, and shell names that are data;
- a Linux-only PATH-shim fuzz test. Commands the preflight allows run through the real Nushell with stand-in foreign shells first on `PATH`; a stand-in that records a call fails the test;
- hint coverage. Every hint id has a real Nushell diagnostic, including successful deprecation warnings. Recovery tests run the suggested replacements and check their output and exit status; broad diagnostic IDs also have negative cases;
- claims tests. The teaching guide's executable statements run against the pinned Nushell;
- a manifest contract for peer ranges, the bundle patch, exports, and the published file list;
- documentation tests for the documentation set, serialization placeholders, repeated tested versions, the bundle rows named in the README, and relative markdown links.

## Run it locally

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run test:integration
npm run build
npm pack --dry-run
```

`npm test` expects the pinned Nushell on `PATH`. The differential and hint tests report a skip when it is missing, while the preflight tests fail; a run without the pinned Nushell is not a full verification.

## Parser probes and differential corpus

The preflight reads Nushell's own parse instead of a second lexer; [ADR 0004](adr/0004-ast-based-preflight.md) records why. The suite pins both halves:

- the token and diagnostic contract, so the preflight sees the fields it expects on every supported platform;
- the command corpora, run against the pinned binary. A rule change needs a command that the pinned Nushell really rejects, or a silent misread pinned by the separate exit-0 test; an assumption is not enough.

A numbered stderr redirect is the second kind: Nushell accepts it as an ordinary argument, exits 0, and redirects nothing. The test runs it, asserts that silent behaviour, and then asserts that the preflight refuses it.

## When the probes cannot run

If either probe fails, times out, or returns an unexpected shape, the preflight cannot run. Boot runs a token and diagnostic canary when `verifyNu` is on and either check is enabled: `^true` must expose a `shape_external` token and `echo hi 2>&1` must map to `stderr-redirect`. With `requireNu` (the default) a canary failure fails boot, and with `requireNu: false` each call is refused before a process starts. The error says the AST preflight could not run and names `enforceNushellOnly: false` and `syntaxLint: false` as the escape hatches, plus the tested Nushell version. Running a command unchecked would drop the only-Nushell guarantee, so the executor fails closed. The suite covers the failure: analysis rejects with a preflight error and the syntax check refuses the command.

## PATH-shim fuzz

The suite has a Linux-only PATH-shim fuzz test. It writes stand-in executables for foreign shells, puts them first on `PATH`, and runs the command shapes the preflight allows; if a stand-in records a call, the preflight missed a handoff. The corpus comes from a fixed seed, so a failure is reproducible. The test skips on macOS and Windows because the shims are POSIX scripts; the Linux matrix job runs it as part of `npm test`.

## Integration probe and boot

The release gate needs a probe against the pinned dsh. `npm run probe` mounts the shell executor, the native tool executor, and the teaching layer in a real composition, then checks that all three rows exist and the platform shell executor rows are disabled. It boots a temporary profile with `--dump-config`, inspects the composed tree, and does not call a model.

`npm run test:integration` goes further. It creates a scratch `DSH_HOME`, writes a profile that mounts this package, copies a small probe plugin into the profile, and boots the real dsh. The probe runs Nushell builtins through the live shell seam, checks that a foreign shell and a bash redirection are refused before a process exists, checks the failure hint, and inspects the assembled prompt and tool description. It boots twice by default: native mode checks the tool description, and PTC mode also checks the generated `tools:sdk` declarations. Pass `--native` or `--ptc` to run one mode. Both commands need the linked peers, a built `dist/`, and a dsh executable; the integration boot also needs a POSIX host and runs on Linux CI.

## CI matrix

A code pull request runs Ubuntu, macOS, and Windows with the pinned Nushell installed. Because `npm test` exercises the two IDE probes, all three platforms exercise the preflight. The Linux job also runs the integration boot. A docs-only pull request runs the Docs workflow. CI is the milestone gate, not the fast loop: run the local commands above while working, and let a pull request verify the platform matrix once.

## Manually verified

- The composed-config probe (`npm run probe`) is manual; Linux CI runs the integration boot instead.
- The real-model teaching eval is manual and not part of PR CI: three arms, three samples per case and arm, cross-model judging, and dated reports. See [`eval/README.md`](../eval/README.md).
- Environment-dependent hint samples assert the hint only when the host really produces that error, and report a visible skip otherwise.
- English/Chinese heading parity and the acknowledgements boundary are review rules, not tests. The docs test no longer enforces them.

## Known limits

- The supported pair is dsh `0.2.2-alpha.2` and Nushell `0.116.1`.
- The guard is not a sandbox. It follows literal shell names, a fixed launcher table, `run-external`, and literal `nu -c` / `nu -e` scripts to depth 4. A dynamic shell name, a program that starts a shell itself, a shell name hidden in data, or a script file loaded by `nu <file>`, `source`, or `use` is out of reach. Plain quoted strings are data; `$"…"` / `$'…'` interpolation is inspected as code.
- Hints explain recognized Nushell errors and deprecation warnings; successful deprecations also receive a hint. Actual errors take priority over warnings. Ordinary exit-0 stderr, timeouts, aborted calls, and sandbox denials receive no hint. Preflight refusals carry their own guidance.
- [The session scanner](../dev/session-scan.md) aggregates explicit local event files. Its counts distinguish unknown exit status from failure; it does not infer repair or task success.
- Because the preflight fails closed, a Nushell whose IDE output does not match the tested shape refuses calls until the pair is aligned.
- Windows has no differential hint sample for file permissions in CI; the permission sample is skipped there.
