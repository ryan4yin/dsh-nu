# Nushell friction review

What real Nushell 0.115.1 and the commands that failed while building this bundle changed, and what is still a known gap. Every item below comes from a command that was run against the pinned binary.

## Refusals met while building

The guard and the dialect preflight refused commands written by the agent that built this project. Each refusal was checked against the real shell:

- `2>/dev/null` and `2>nul` are not redirections. Nushell accepts them as ordinary arguments, exits 0, and does nothing; the preflight refuses them so the silent no-op never reaches the model as a success. `2> file` with a real target is the parser error `nu::parser::shell_err`.
- `2>&1` is `nu::parser::shell_outerr` (`o+e>` in Nushell), so it is refused.
- `mkdir -p` and `ls -R` fail with `nu::shell::unknown_flag`. Nushell creates parent directories itself and uses a glob for recursion; the refusal gives the replacement.
- `$?` is not a variable. Nushell reports `Incomplete variable`, and the guard points at `(do { cmd } | complete).exit_code`.
- `Start-Sleep` is a PowerShell cmdlet, not a Nushell command. The cmdlet rule catches it and points at `sleep 2sec`.

## Nushell behaviour that is not a syntax error

A scanner cannot repair these by rewriting the command. They are real Nushell behaviour, so the guide and the hints explain them:

- `print "x" | str length` fails with `nu::parser::input_type_mismatch`. `print` writes to stdout but returns nothing, so the next stage gets no value. The friction corpus uses `"x" | str length`, and the teaching layer says to put `print` last or let the final value stand.
- `>` is comparison in Nushell. A shell-looking `cmd > file` writes nothing and exits 0, which is why the guide names `o>`, `e>`, and `o+e>`.
- `mut x = 1` is required before `$x = 2`. The bare-assignment rule skips a variable that was declared with `mut`.
- Writing under `/sys` reports `nu::shell::io::read-only_filesystem_or_storage_medium` on some Linux hosts and `permission_denied` on others. The hint test asserts the read-only hint only when the real EROFS error appears, and reports a skip otherwise.

## What changed

- The guard's foreign-shell and launcher sets, quoting, comments, and allowlist are covered by unit tests and by the differential corpus.
- A dialect rule is added only when the pinned Nushell rejects the fragment, so the rules follow the binary.
- Every hint pattern has a real failing command in `test/dialect.test.ts`.
- `test/friction.test.ts` runs 30 realistic agent commands through the preflight and then through the real shell.
- `test/dialect.test.ts` accepts and refuses commands by running them, so a rule that is wrong about Nushell fails the suite.

## Known gaps

- The preflight is a heuristic scanner, not a parser. Habits inside strings, comments, or raw strings are data and pass; unusual constructs may need an allowlist entry.
- Hints only fire after Nushell reports an error; a refused command has no hint.
- Windows has no permission-denied hint sample in CI; the sample is skipped there.
- The corpus covers common agent commands, not every Nushell feature. A command outside it that the guard refuses wrongly should become a corpus entry.
- A bare `>` is comparison in Nushell, and `cmd > file` silently writes nothing while exiting 0. No preflight rule catches it: the same token is a legitimate comparison, and a heuristic would refuse valid code. The guide warns about it, and this stays a documented limitation.
