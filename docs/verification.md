# Verification

English | [中文](zh/verification.md)

## What the suite covers

`npm test` covers:

- unit tests for executable resolution, argv assembly, the foreign-shell scanner, the dialect rules, the teaching rewrites, the executor seam, boot probing, confinement, and inherited budgets;
- a differential corpus. Every preflight refusal runs against the pinned Nushell and must fail; the one silently-wrong family is asserted separately, and every allowed command must run;
- hint coverage. Every hint id has a real failing command, and the test checks the hint against that command's actual stderr;
- claims tests. The teaching guide's executable statements run against the pinned Nushell;
- a manifest contract for peer ranges, the bundle patch, exports, and the published file list;
- documentation tests for EN/ZH heading parity, pinned versions, relative links, and the acknowledgement boundary.

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

`npm test` skips the differential tests when `nu` is not on `PATH`, and the skips appear in the output. A run without the pinned Nushell is not a full verification.

## Differential corpus

The refused list covers numbered and stderr redirection, `$env:`, bare and per-command assignment, `export`, `foreach`, cmdlets, `$_.`, PowerShell `-not` and flag verbs, common parameters, `&&` / `||`, command substitution, `$?`, array literals, percent blocks, negative counts, unknown Nushell flags, comma columns, glob named arguments, and redirection after a pipe. A rule change needs a command that the pinned Nushell really rejects; an assumption is not enough. The allowed list checks that the preflight does not refuse valid Nushell, quoted data, comments, or external-tool syntax.

## Hint coverage

Each hint pattern matches an error id the pinned Nushell actually prints, for example `nu::parser::shell_outerr`, `nu::shell::io::not_found`, or `nu::shell::pipeline_mismatch`. The test runs the matching command and passes the captured stderr to the hint function. There are no stored stderr fixtures: every sample comes from the installed Nushell on each run, so a fixture cannot drift away from the binary in use. One sample depends on the host: writing under `/sys` reports EROFS on some Linux hosts and EACCES on others. The test asserts the read-only hint only when that error really appears, and reports a skip otherwise.

## Integration probe and boot

The release gate needs a probe against the pinned dsh. It mounts the executor and the teaching layer in a composition, then checks that both rows exist and the platform shell executor rows are disabled. `npm run probe` does this against the real dsh CLI. It builds a temporary profile that names this package after dsh-base, boots the profile with `--dump-config`, and inspects the composed tree. It needs a dsh executable (`DSH_INTEGRATION_CLI` or `dsh` on PATH), the linked peers, and a built `dist/`. It does not call a model.

`npm run test:integration` goes further. It creates a scratch `DSH_HOME`, writes a profile that mounts this package, copies a small probe plugin into the profile, and boots the real dsh. The probe runs Nushell builtins through the live shell seam, checks that a foreign shell and a bash redirection are refused before a process exists, checks the failure hint, and inspects the assembled prompt and tool description. It has the same prerequisites as the probe and a POSIX host for the current probe; CI runs it on Linux. By default it boots twice: native mode checks the tool description, and PTC mode also checks the generated `tools:sdk` declarations. Pass `--native` or `--ptc` to run one mode.

## CI matrix

A code pull request runs Ubuntu, macOS, and Windows with the pinned Nushell installed. A docs-only pull request runs the Docs workflow instead. CI is the milestone gate, not the fast loop: run the local commands above while working, and let a pull request verify the platform matrix once.

## Known limits

- The supported pair is dsh `0.2.1-rc.2` and Nushell `0.115.1`.
- The preflight is a heuristic scanner, not a parser. A habit inside a string or comment is data and passes; an unusual construct can still need an allowlist entry.
- Hints only fire after Nushell reports an error. A command refused before spawning has no hint.
- Windows has no differential hint sample for file permissions in CI; the permission sample is skipped there.
