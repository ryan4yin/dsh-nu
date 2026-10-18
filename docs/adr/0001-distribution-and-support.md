# 1. Distribution, support, and the release gate

- Status: accepted
- Date: 2026-10-18

## Context

dsh-nu is a standalone bundle that replaces the shell executor of DeepSeek Harness. It has to be installable by people who already run dsh. It should not claim compatibility with versions it was never tested against, and it should not become public before the first release is usable.

## Decision

### Distribution

npm is the primary channel. A release publishes a tarball with the built `dist/`, and users install the package as a dsh bundle. Installing from a git checkout is a developer channel: it is documented, but it is not the supported path for users because it requires a local build and peer linking. `dist/` is never committed.

### Supported pair

Every release names exactly one tested pair in `package.json` under `testedWith`. For 0.1.0 the pair is dsh `0.2.1-rc.2` and Nushell `0.115.1`. Boot warns when the resolved Nushell differs, because the guard, hints, and guide are tuned to the tested version. Supporting a range of dsh or Nushell versions is out of scope until the single pair has shipped and been exercised.

### Release gate

A release candidate must pass, locally and in CI:

1. `npm run typecheck`, `npm run build`, `npm test`, and `npm pack --dry-run` from a clean checkout.
2. The unit suite, including the differential corpus. Every preflight refusal must fail in the pinned real Nushell, every allowed command must run, and every hint must be produced by a real failing command.
3. The integration probe against the pinned dsh. A composition with the plugin mounted must expose the Nushell executor, refuse a foreign-shell call, and show Nushell tool text.
4. The CI matrix: Ubuntu, macOS, and Windows, with the pinned Nushell installed.
5. The documentation tests: EN/ZH heading parity, pinned versions repeated, relative links resolved, and no upstream repository link outside the README acknowledgements.

CI runs on pull requests, not on every push. Local checks are the fast loop; CI is the milestone gate before a merge that matters and before a release.

### Visibility

The repository stays private until 0.1.0 is published and verified. After that it becomes public. The acknowledgement section is the only place that references upstream projects.

## Consequences

- A version bump needs a new tested pair, not a widened range.
- The git channel can drift from the published tarball, which is why the README says npm is the supported install.
- CI minutes are spent once per pull request instead of once per commit.
- A test enforces the acknowledgement rule, not review alone.

## Alternatives considered

- Committed build output instead of npm. Rejected: it duplicates the build and makes the git channel look supported.
- A broad dsh version range. Rejected: the shell seam and the prompt assembly contract change between releases.
- A public repository before the first release. Rejected: an unfinished install surface would be the public first impression.
