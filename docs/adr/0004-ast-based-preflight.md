# 4. Read the preflight from Nushell's own parser

- Status: accepted
- Date: 2026-10-19

## Context

The preflight (the guard and the syntax rules) used hand-written lexers: a blanking pass for quotes and comments, statement splitting, and pattern matching. Every approximation of Nushell's grammar produced both false positives and false negatives. The audit found:

- `$'…'` escape sequences could hide a handoff the scanner did not follow.
- A launcher over-scan refused valid commands: `timeout 5 grep -r sh /tmp` counted as a handoff because a later argument contained `sh`.
- A quoted string in command position, `'bash -c …' | save`, was refused even though Nushell treats the string as data.
- `print hi > 1.txt` was silently accepted even though Nushell writes nothing.
- A user-defined name masked a path-qualified shell: `def sh …; /bin/sh` was not refused.

The upstream project this bundle reimplements is also hand-written and deliberately narrow. Matching its rules would keep the missing cases rather than close them.

Nushell exposes the parse that `nu -c` will run through two read-only CLI probes. The in-Nushell `ast --json` command is not enough: it omits nested blocks and subexpressions, so a handoff inside a block or an interpolated string disappears from its output.

## Decision

The preflight reads Nushell's parser instead of a second grammar:

- Two read-only probes run concurrently over the command written to a private temporary script: `nu --no-config-file --ide-ast <file>` returns the flat token stream (shape, content, span), and `nu --no-config-file --ide-check 100 <file>` returns the parser diagnostics.
- A small LRU cache absorbs repeated commands.
- If the probes cannot run, the command is refused instead of spawning with the check skipped (fail closed). Boot runs a token and diagnostic canary when `verifyNu` is on and a check is enabled: with the default `requireNu` a failure fails boot, and with `requireNu: false` each call is still refused. The error names the config escape hatches.
- The guard keeps a finite semantic layer over the tokens: foreign shell names (bare, path-qualified, or `^`-forced), a fixed launcher table, `run-external`, and literal `nu -c` scripts followed to depth 4. A dynamic shell name and a program that starts a shell itself are outside its reach. The guard is not a sandbox.
- The syntax rules map stable diagnostics and token shapes to the existing rule ids. Forms Nushell accepts but misreads, such as a numbered stderr redirect, are still refused; the parser alone cannot know the author meant a shell redirect.
- Plain quoted strings are data. `$'…'` and `$"…"` interpolate, and the parser already exposes each parenthesized expression as code.

## Considered options

- **Keep fixing the hand-written lexers.** Rejected: every fix addressed one approximation of the grammar and introduced another; the same scanner produced false positives and false negatives.
- **Use `ast --json`.** Rejected: it omits nested blocks and subexpressions, so nested and interpolated handoffs stay invisible.
- **Keep a resident worker process.** Measured at 1.7 ms per request against roughly 14–16 ms for the two CLI probes, but the worker can only call `ast`, not `--ide-ast` / `--ide-check`, which are CLI actions. It also adds idle CPU, orphan-process, and temp-directory lifecycle costs. Rejected.
- **Narrow the rules to the upstream project's scope.** Rejected: it keeps the known misses (`env -S`, `xargs`, `timeout … bash`, nested and interpolated handoffs) instead of fixing them.

## Consequences

- Cold preflight costs about 14–16 ms per shell call (two probes in parallel); a cache hit costs about 0 ms.
- The preflight depends on the tested Nushell's IDE output, so token shapes and diagnostics are version-sensitive. The tested pair stays pinned, contract tests pin the shapes and offsets the preflight reads, and the Windows and macOS CI jobs run the same suite.
- A differential corpus runs the refused commands against the pinned Nushell. A PATH-shim fuzz test runs in the Linux matrix job as part of `npm test`.
- The allowlist and `enforceNushellOnly: false` remain the escape hatches. The guard is not a sandbox.
