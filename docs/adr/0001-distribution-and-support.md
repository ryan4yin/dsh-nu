# ADR 0001: distribution, support surface, and the release gate

- Status: accepted
- Date: 2026-10-18

## Context

dsh-nu is a standalone bundle that replaces the shell executor of DeepSeek
Harness. It must be installable by people who already run dsh, it must not
claim compatibility with versions it was never tested against, and it must not
become public before the first release is usable.

## Decision

### Distribution

npm is the primary channel: a release publishes a tarball with the built
@BT@dist/@BT@, and users install the package as a dsh bundle. Installing from a
git checkout is a developer channel and is documented, but it is not the
supported path for users because it requires a local build and peer linking.
@BT@dist/@BT@ is never committed.

### Supported pair

Every release names exactly one tested pair in @BT@@BT@@BT@package.json@BT@@BT@@BT@ under @BT@@BT@@BT@testedWith@BT@@BT@@BT@. The pair is
dsh @BT@0.2.1-rc.2@BT@ and Nushell @BT@0.115.1@BT@ for 0.1.0. Boot warns when the
resolved Nushell differs; the guard, hints, and guide are tuned to the tested
version. Supporting a range of dsh or Nushell versions is out of scope until
the single pair has shipped and been exercised.

### Release gate

A release candidate must pass, locally and in CI:

1. @BT@@BT@@BT@npm run typecheck@BT@@BT@@BT@, @BT@@BT@@BT@npm run build@BT@@BT@@BT@, @BT@@BT@@BT@npm test@BT@@BT@@BT@, and @BT@@BT@@BT@npm pack --dry-run@BT@@BT@@BT@ from a clean checkout.
2. The unit suite, including the differential corpus: every preflight refusal
   must fail in the pinned real Nushell, every allowed command must run, and
   every hint must be produced by a real failing command.
3. The integration probe against the pinned dsh: a composition with the plugin
   mounted must expose the Nushell executor, refuse a foreign-shell call, and
   show Nushell tool text.
4. CI matrix: Ubuntu, macOS, and Windows, with the pinned Nushell installed.
5. The documentation tests: EN/ZH heading parity, pinned versions repeated,
   relative links resolve, and no upstream repository link outside the README
   acknowledgements.

CI runs on pull requests, not on every push. Local checks are the fast loop; CI
is the milestone gate before a merge that matters and before a release.

### Visibility

The repository stays private until 0.1.0 is published and verified. After the
release the repository becomes public; the acknowledgement section is the only
place that references upstream projects.

## Consequences

- A version bump needs a new tested pair, not a widened range.
- The git channel can drift from the published tarball; the README says npm is
  the supported install.
- CI minutes are spent once per pull request instead of once per commit.
- The acknowledgement rule is enforced by a test, not by review alone.

## Alternatives considered

- Committed build output instead of npm: rejected because it duplicates the
  build and makes the git channel look supported.
- Supporting a broad dsh version range: rejected because the shell seam and the
  prompt assembly contract change between releases.
- Public repository before the first release: rejected because an unfinished
  install surface would be the public first impression.
