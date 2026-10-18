# Teaching eval: first real-model round

Date: 2026-10-18

## Setup

- Bundle: this branch, built from the local checkout.
- dsh: 0.2.1-rc.2; Nushell: 0.115.1.
- Cases: six fixed tasks covering JSON, first lines, Markdown discovery, exit codes,
  cross-call state, and stderr redirection.
- Arms: `full` (shipped teaching) and `off` (`guide: off`, `rules: false`,
  `rewriteToolDescriptions: false`). Both keep the guard and dialect preflight.
- Samples: three per case and arm for each actor, 36 samples per actor.
- Actors: GPT-6 Luna and DeepSeek Flash. Judges: each actor scored the anonymised
  samples from both actors, excluding its own actor from the summary.

Raw events and model configuration stayed in a local untracked workspace.

## Deterministic results

`taskSuccess` requires the expected answer and the case's shell-call budget.
`answerMatched` ignores the budget.

| actor | arm | task success | answer matched | first clean | violations | refused | tokens |
|---|---|---|---:|---:|---:|---:|---:|---:|
| GPT-6 Luna | full | 17/18 | 18/18 | 18 | 0 | 0 | 733,098 |
| GPT-6 Luna | off | 16/18 | 18/18 | 11 | 10 | 10 | 847,774 |
| DeepSeek Flash | full | 17/18 | 18/18 | 18 | 0 | 0 | 750,825 |
| DeepSeek Flash | off | 13/18 | 18/18 | 8 | 14 | 14 | 924,422 |

Both arms eventually produced the right answer for every sample. The difference is
how they got there: the `off` arm repeatedly wrote shapes the guard refused (ten
and fourteen times), spent extra turns recovering, and consumed 11-19% more
tokens. The only strict task failures in the `full` arm were call-budget misses:
one Markdown sample used three calls instead of the requested one, and one stderr
sample used five; their answers were correct.

## Cross-model score

Mean score from the other actor, 0-2, per anonymised sample set:

| actor | arm | samples | mean |
|---|---|---:|---:|
| GPT-6 Luna | full | 18 | 1.89 |
| GPT-6 Luna | off | 18 | 1.56 |
| DeepSeek Flash | full | 18 | 1.67 |
| DeepSeek Flash | off | 18 | 1.06 |

## Reading

The teaching layer did not change whether these two models could eventually solve
these tasks. It changed first-pass validity, refusal recovery, and cost. That is
the effect the guide is meant to have, so this round does not justify more rules.
The next useful checks are a case that requires a less common Nushell idiom and a
run on the local model, where latency makes the retry cost larger.
