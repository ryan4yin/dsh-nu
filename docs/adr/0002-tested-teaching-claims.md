# 2. Test the teaching prose against the real Nushell

## Status

Accepted.

## Context

The guard, the dialect rules, and the hints were checked against the pinned Nushell binary from the start. The prose that teaches the model was not checked. The guide's statements about quotes, `to json`, and `and`/`or` were written from memory, and an audit found several of them wrong. A docs test that only checks headings and links cannot catch a false statement about Nushell.

## Decision

Every model-facing claim that can be executed becomes a test:

- `test/claims.test.ts` runs the guide's examples against the real `nu` and asserts their output.
- `test/integration/` boots a real dsh composition and checks the assembled prompt, the shell tool description, and the PTC SDK text.
- Unit tests pin the SDK rewrite, including sentence punctuation.

Remove a claim that cannot be executed, or record it as a known limitation. Do not present it as verified.

## Consequences

The test suite now needs `nu` on `PATH`, and the integration probe also needs a built `dist/` and the linked peers. A wrong sentence fails a test instead of shipping. The remaining unexecutable statements are deliberate limitations, not accidental guesses.
