# 3. Prefer real executions over stored fixtures

## Status

Accepted.

## Context

An earlier implementation of this bundle stored captured Nushell stderr as
fixture files and tested the hint function against those files. That proves the
hint matches a past error, but not that the error still comes from the Nushell
the deployment runs. It also lets a fixture drift: the binary changes, the file
stays, and the suite stays green.

The bundle's failure modes are end-to-end: a command either reaches Nushell and
fails, or the preflight refuses it, or the guard refuses it. The most valuable
checks therefore execute the real binary and the real dsh composition.

## Decision

Prefer executable, real-binary tests:

- every dialect rule and hint has a command that the pinned Nushell really runs;
- the teaching guide's executable claims run against the same binary;
- the integration probe boots a real dsh composition in native and PTC modes and
  observes the live shell seam, prompt, tool description, and SDK text;
- static fixtures are not stored. A hint sample is generated on each run, so it
  cannot disagree with the installed binary.

Host-dependent failures (a read-only `/sys`, a permission sample on Windows)
are the exception: the test asserts the matching hint when the host really
produces that error and reports a visible skip otherwise. A class that cannot
be reproduced at all is a known limitation, not a fixture.

## Consequences

The suite needs `nu` on `PATH`; the integration probe also needs a built
`dist/`, the linked dsh peers, and a POSIX host. CI installs the pinned pair and
runs the integration boot on Linux. A wrong rule or a stale hint fails against
the current binary instead of matching a stored string.
