# Verification

## What the suite covers

`npm test` runs four kinds of tests:

- unit tests for executable resolution, argv assembly, the foreign-shell
  scanner, the dialect rules, the teaching rewrites, and the executor seam;
- a differential corpus: every preflight refusal is executed with the pinned
  real Nushell and must fail, and every allowed command must run;
- hint coverage: every hint id has a real failing command, and the test asserts
  the hint is produced from that command's actual stderr;
- documentation tests: EN/ZH heading parity, pinned versions, relative links,
  and the acknowledgement boundary.

## Run it locally

```sh
npm install
node dev/link-peers.mjs --root <dsh-install-root>
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`npm test` skips the differential tests when `nu` is not on `PATH`; the
skips are visible in the test output. A run on a machine without the pinned
Nushell is not a full verification.

## Differential corpus

The refused list covers numbered redirection, `$env:`, bare assignment, `foreach`,
cmdlets, `&&` / `||`, command substitution, `$?`, unknown Nushell flags, and comma
columns. A rule change needs a command that the pinned Nushell really rejects;
an assumption is not enough. The allowed list proves the preflight does not
refuse valid Nushell or external-tool syntax.

## Hint coverage

Each hint pattern matches an error id the pinned Nushell actually prints, for
example `nu::parser::shell_outerr`, `nu::shell::io::not_found`, or
`nu::shell::pipeline_mismatch`. The test executes the matching command and
feeds the captured stderr to the hint function. One sample is host-dependent:
writing under `/sys` reports EROFS on some Linux hosts and EACCES on others, so
the test asserts the read-only hint only when that real error appears and says
so when it skips.

## Integration probe

The release gate requires a probe against the pinned dsh: mount the executor and
the teaching layer in a composition, confirm that the executor and teaching rows
are present, and confirm that the platform shell executor rows are disabled.
`npm run probe` does this against the real dsh CLI: it builds a temporary
profile that names this package after dsh-base, boots the profile with
`--dump-config`, and inspects the composed tree. It needs a dsh executable
(`DSH_INTEGRATION_CLI` or `dsh` on PATH), the linked peers, and a built
`dist/`. It does not call a model.

## CI matrix

CI runs on pull requests for Ubuntu, macOS, and Windows with the pinned Nushell
installed. It is the milestone gate, not the fast loop: run the local commands
above while working, and let a pull request verify the platform matrix once.

## Known limits

- The supported pair is dsh `0.2.1-rc.2` and Nushell `0.115.1`.
- The preflight is a heuristic scanner, not a parser. A habit inside a string or
  comment is data and passes; an unusual construct can still need an allowlist
  entry.
- The hints only fire after Nushell reports an error; a command refused before
  spawning has no hint.
- Windows has no differential hint sample for file permissions in CI; the
  permission sample is skipped there.
