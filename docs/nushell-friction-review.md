# Nushell friction review

What real Nushell 0.115.1 and the commands that failed while building this bundle changed, and what is still a known gap. Every item below comes from a command that was run against the pinned binary.

## Refusals met while building

The guard and the dialect preflight refused commands written by the agent that built this project. Each refusal was checked against the real shell:

- `2>/dev/null`, `2>nul`, and `2>> file` are not redirections. Nushell accepts them as ordinary arguments, exits 0, and does nothing; the `stderr-as-word` preflight rule refuses them so the silent no-op never reaches the model as a success. `2> file` with a space and a real target is the parser error `nu::parser::shell_err`, refused as `stderr-file`.
- `2>&1` is `nu::parser::shell_outerr` (`o+e>` in Nushell), so it is refused.
- `mkdir -p` and `ls -R` fail with `nu::shell::unknown_flag`. Nushell creates parent directories itself and uses a glob for recursion; the refusal gives the replacement.
- `$?` is not a variable. Nushell reports `Incomplete variable`, and the guard points at `(do { cmd } | complete).exit_code`.
- `Start-Sleep` is a PowerShell cmdlet, not a Nushell command. The cmdlet rule catches it and points at `sleep 2sec`.

## Nushell behaviour that is not a syntax error

A scanner cannot repair these by rewriting the command. They are real Nushell behaviour, so the guide and the hints explain them:

- `print "x" | str length` fails with `nu::parser::input_type_mismatch`. `print` writes to stdout but returns nothing, so the next stage gets no value. The friction corpus uses `"x" | str length`, and the teaching layer says to put `print` last or let the final value stand.
- `>` is comparison in Nushell. A shell-looking `cmd > file` writes nothing and exits 0, which is why the guide names `o>`, `e>`, and `o+e>` and the `stdout-redirect` rule refuses the shell spelling when the target looks like a path.
- `mut x = 1` is required before `$x = 2`. The bare-assignment rule skips a variable that was declared with `mut`.
- Writing under `/sys` reports `nu::shell::io::read-only_filesystem_or_storage_medium` on some Linux hosts and `permission_denied` on others. The hint test asserts the read-only hint only when the real EROFS error appears, and reports a skip otherwise.

## What changed

- The guard's foreign-shell and launcher sets, quoting, comments, and allowlist are covered by unit tests and by the differential corpus.
- A dialect rule is added when the pinned Nushell rejects the fragment or silently misreads it; the silent cases are pinned separately because exit 0 proves nothing.
- Every hint pattern has a real failing command in `test/dialect.test.ts`.
- `test/friction.test.ts` runs 30 realistic agent commands through the preflight and then through the real shell.
- `test/dialect.test.ts` accepts and refuses commands by running them, including the silent redirects that exit 0 but write nothing, so a rule that is wrong about Nushell fails the suite.

## Known gaps

- The preflight is a heuristic scanner, not a parser. Habits inside strings, comments, or raw strings are data and pass; unusual constructs may need an allowlist entry.
- Hints only fire after Nushell reports an error; a refused command has no hint.
- Windows has no permission-denied hint sample in CI; the sample is skipped there.
- The corpus covers common agent commands, not every Nushell feature. A command outside it that the guard refuses wrongly should become a corpus entry.
- The `stdout-redirect` target check is a heuristic: a target with a path marker (extension, slash, colon, or `nul`) is refused, so `cmd > out.txt` and `cmd > /dev/null` are caught, while `where size > 1kb` and `if $n > 2` stay valid. A target with no path marker (`cmd > out`) is indistinguishable from a comparison and remains a guide warning.
