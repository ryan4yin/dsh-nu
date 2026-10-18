# Guide sources and maintenance

The model-facing prose lives here:

- `rules.md`: mandatory shell rules, always included by `buildRules()`.
- `full.md`: detailed syntax guide, selected by `guide: full`.
- `compact.md`: condensed syntax guide, selected by `guide: compact`.
- `tool-description.md`: rewritten shell-tool description.

The one-line command argument description stays in `src/guide.ts`. The build
copies only the four files above into `dist/guides`; this maintenance README is
not shipped.

## Sources

- **Nushell 0.115.1, the pinned runtime.** Every executable claim is checked by
  `test/claims.test.ts`; observed failures are recorded in
  [`docs/nushell-friction-review.md`](../../docs/nushell-friction-review.md).
- **Nushell official documentation:**
  [Coming from Bash](https://www.nushell.sh/book/coming_from_bash.html),
  [Coming to Nu](https://www.nushell.sh/book/coming_to_nu.html), and the
  [style guide](https://www.nushell.sh/book/style_guide.html). These are
  references for terminology, migration contrasts, and idioms; the prose here
  is rewritten and validated against the pinned binary, not copied.
- [`hustcer/nushell-pro`](https://github.com/hustcer/nushell-pro): community
  best practices and idioms. It informed the echo/for, optional-field, and
  stream-discard guidance; each point still has a real command test.
- **Real DSH session failures.** The wait/background rules came from legacy
  bash/PTC sessions. Those sessions are hypotheses, not evidence about current
  Nushell behaviour; the eval cases in `eval/cases.json` test the Nushell
  behaviour directly.

This repository's executable tests, not external prose, decide whether a claim
stays.

## Maintenance

When changing the Nushell or DSH pins:

1. Run the full suite against the new binary: `npm test`, `npm run build`,
   and `npm run test:integration`. Update `testedWith` and the peer ranges in
   `package.json` only after those pass.
2. Reproduce a failing command on the pinned binary before adding or changing a
   rule or hint. Add the executable assertion first; see
   `test/claims.test.ts` and `test/dialect.test.ts`.
3. Update `full.md` and `compact.md` together. Compact is a condensed version
   of the same policy, not a separate policy. Keep `rules.md` to rules a shell
   call must never break.
4. Run the real-model eval after teaching changes; see
   [`eval/README.md`](../../eval/README.md). Do not infer Nushell behaviour
   from old bash sessions.
5. Re-check the source links and add a new source here when one is used.

Last validated: Nushell 0.115.1 with DSH 0.2.1-rc.2.
