# Nushell friction review

What real Nushell 0.115.1 and the commands that failed while building this bundle changed, and what is still a known gap. Every item below comes from a command that was run against the pinned binary.

## Refusals met while building

The guard and the syntax rules refused commands written by the agent that built this project. Each refusal was checked against the real shell:

- `2>/dev/null`, `2>nul`, and `2>> file` are not redirections. Nushell accepts them as ordinary arguments, exits 0, and does nothing; the `stderr-as-word` syntax rule refuses them so the silent no-op never reaches the model as a success. `2> file` with a space and a real target is the parser error `nu::parser::shell_err`, refused as `stderr-file`.
- `2>&1` is `nu::parser::shell_outerr` (`o+e>` in Nushell), so it is refused.
- `mkdir -p` and `ls -R` fail with `nu::shell::unknown_flag`. Nushell creates parent directories itself and uses a glob for recursion; the refusal gives the replacement.
- `$?` is not a variable. Nushell reports `Incomplete variable`, and the syntax rules point at `(do { cmd } | complete).exit_code`.
- `Start-Sleep` is a PowerShell cmdlet, not a Nushell command. The cmdlet rule catches it and points at `sleep 2sec`.

## Nushell behaviour that is not a syntax error

A syntax rule cannot repair these by rewriting the command. They are real Nushell behaviour, so the guide and the hints explain them:

- `print "x" | str length` fails with `nu::parser::input_type_mismatch`. `print` writes to stdout but returns nothing, so the next stage gets no value. The friction corpus uses `"x" | str length`, and the teaching layer says to put `print` last or let the final value stand.
- `>` is comparison in Nushell. A shell-looking `cmd > file` writes nothing and exits 0, which is why the guide names `o>`, `e>`, and `o+e>` and the `stdout-redirect` rule refuses a bare `>`/`<` in argument position regardless of the target; comparisons are operator tokens, so `where size > 1kb` and `if 3 > 2` stay valid.
- `mut x = 1` is required before `$x = 2`. A bare `$x = 2` is refused as `bare-assignment`; after `let`, Nushell's own `immutable-assignment` hint explains the fix instead, so the preflight leaves it to the runtime error.
- Writing under `/sys` reports `nu::shell::io::read-only_filesystem_or_storage_medium` on some Linux hosts and `permission_denied` on others. The hint test asserts the read-only hint only when the real EROFS error appears, and reports a skip otherwise.

## Review pass

A later review of the guard, preflight, and executor ran each finding against the pinned binary before fixing it:

- `FOO=1 ^printenv FOO` prints `1`, so a per-command environment prefix is valid Nushell. The old `prefix-assignment` rule refused it; the rule is gone and the allowed corpus pins the working command.
- `print a#b; bash -c 'echo H'` runs bash: `#` starts a comment only at a token boundary. The parser keeps `a#b` as one bare word, so the mid-word `#` no longer hides the handoff.
- `print $"a(bash -c 'echo I')b"` prints `aIb`. `$"…"` and `$'…'` interpolate, so the parser exposes each parenthesized part as code; plain quoted text stays data.
- `do { /bin/sh -c … }`, `do { env bash … }`, `do { FOO=1 bash … }`, and `let x = (env bash …)` start a foreign shell, while the old guard only inspected the block head. The guard now covers every command position: block, subexpression, separator, pipe, path-qualified program, environment prefix, and launcher.
- Multiline records, lists, and closures, `match "bash" { bash => 1 }`, `{ sh : 1 }`, and `|sh, ...rest|` were refused by the guard. The parser decides where statements end, and record keys, match arms, and closure parameters are no longer command positions.
- On Windows every confined call failed: the parent passes the `ShellExecSpec` to `confine`, which read `.command` from a string. The seam now accepts both shapes.
- Hints were appended to ordinary exit-0 calls and to sandbox denials, and a junk `nu --version` could still boot. That review restricted hints to non-zero exits without denial, and required the version probe to report a version. Successful deprecation warnings are now an explicit exception; see [hint handling](troubleshooting.md#a-result-carries-a-nushell-hint).
- The generated PTC `tools:sdk` text kept host claims (`${VAR:?}`, `$env:`, case-insensitive variables, pwsh sandbox modes). The rewrite now removes them.

## What changed

- The guard's foreign-shell names, launcher table, wrapper chains, nested and interpolated handoffs, and allowlist are covered by unit tests and the Linux-only PATH-shim fuzz test.
- A syntax rule is added when the pinned Nushell rejects the fragment or silently misreads it; the silent cases are pinned separately because exit 0 proves nothing.
- Every hint pattern has a real diagnostic sample in `test/syntax.test.ts`, including deprecation warnings on successful commands.
- `test/friction.test.ts` runs a corpus of common agent commands through the preflight and then through the real shell.
- `test/syntax.test.ts` accepts and refuses commands by running them, including the silent redirects that exit 0 but write nothing, so a rule that is wrong about Nushell fails the suite.

## Known gaps

- The guard is not a sandbox. Syntax forms inside plain strings, comments, or raw strings are data and pass; `$"…"` / `$'…'` interpolation is code and is inspected. A shell name computed at run time, a program that starts a shell itself, a shell name that exists only as data, and a script file loaded by `nu <file>`, `source`, or `use` are out of reach. The allowlist remains for commands that genuinely need a foreign shell.
- Hints cover recognized errors and deprecations, including successful warnings; [hint handling](troubleshooting.md#a-result-carries-a-nushell-hint) describes their priority and exclusions.
- Windows has no permission-denied hint sample in CI; the sample is skipped there.
- The corpus covers common agent commands, not every Nushell feature. A command outside it that the guard refuses wrongly should become a corpus entry.
- The `stdout-redirect` / `stdin-redirect` checks are token-based: comparisons are operator tokens, so any word starting with `>` or `<` in argument position is refused, including `cmd > out` with no path marker. `where size > 1kb`, `if $n > 2`, and datetime comparisons stay valid because the parser emits them as operators.
