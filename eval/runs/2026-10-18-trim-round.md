# Teaching trim round

Date: 2026-10-18

Removes duplicated prose from the guides and the tool description while keeping
the rewrite block that fixed the session refusals. The eval checks that the
reproduction cases did not get weaker; it does not claim an improvement.

## Size change

| text | before | after | change |
|---|---:|---:|---:|
| `rules.md` | 2,165 | 2,165 | 0 |
| `compact.md` | 1,881 | 1,476 | -22% |
| `full.md` | 5,248 | 4,819 | -8% |
| `tool-description.md` | 1,497 | 878 | -41% |
| full-arm teaching text | 8,909 | 7,862 | -12% |
| compact-arm teaching text | 5,542 | 4,519 | -19% |

The compact guide keeps the bash rewrite block, the pre-send scan, and the
file/text/variable examples; it drops the output, pipeline, print/echo, waiting,
and exit-code lines that the mandatory rules already state. Full drops the
duplicated redirect sentence, the second interpolation sentence, the
waiting/background detail, and the "When Nushell refuses" recap. The tool
description keeps the contract (description argument, budgets, refusal + hint,
serialization) and drops the policy prose that rules and guides own.

## Method

Same layered workflow as the previous round: the four reproduction cases
(`deep-mkdir`, `search-ignore`, `recursive-list`, `chain-step`) on both
models and both arms, three samples; then the remaining three cases; then a
stable-case smoke. One luna key-case run was repeated to bound sample noise.

## Key cases

| actor | arm | before (refusals / samples) | after (refusals / samples) |
|---|---|---:|---:|
| ds41f | full | 0 / 12 | 1 / 12 |
| ds41f | compact | 1 / 12 | 0 / 12 |
| gpt-6-luna | full | 0 / 12 | 0 / 12 (repeat 0 / 12) |
| gpt-6-luna | compact | 0 / 12 | 0 / 12 (repeat 1 / 12) |

The four after-refusals are model-level misses, not trimmed guidance:

- ds41f full: `glob ... | each {|p| ... $_.size}` refused as `current-item`
  (invalid use of the implicit item).
- luna compact repeat: `^sh -c '...' ` refused by the guard as a shell handoff.
- acceptance ds41f compact: `match ... { $x => ... }` refused as
  `bare-assignment`; this is a **pre-existing false positive** in the preflight
  rule, to fix separately.

## Acceptance

- Remaining cases (`proc-inspect`, `tool-presence`, `merge-streams`):
  ds41f 1 / 18 (the match-arm false positive), luna 0 / 18 (before: luna 1 / 18).
- Stable smoke (`json-active`, `stderr-discard`, `background-wait`, both
  arms, two samples): 0 / 12, and 6/6 strict success in both arms (before:
  5/6 and 6/6).

## Reading

- Refusal counts are at parity within one sample per layer; the trim did not
  weaken the reproduction cases.
- Task success is noisy across repeats: luna full answer match was 11/12
  before, 7/12 and 9/12 after the trim, with identical cases. Do not read that
  movement as a teaching effect.
- The prompt is 12-19% smaller per arm, but per-run token totals are dominated
  by model turns, so this round is maintenance, not a cost win.
- Follow-up: the `match ... { $x => ... }` false positive should become its own
  small fix with a regression sample.

Raw samples stay under `.work/eval-out`; this file is the committed record.
