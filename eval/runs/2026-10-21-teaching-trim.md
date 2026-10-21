# Teaching trim round

Date: 2026-10-21

Removes the repeated prose from the teaching text and keeps the shell-tool
description the host's own, with only its shell claims replaced. The guard,
preflight, and case set are unchanged, so this measures the prompt alone.

## Size change

Bytes are the teaching text one request carries: rules, guide, and the shell-tool
description. The description is the host's bash text after `rewriteSdkText`, not
a hand-copied paragraph.

| text | before (main a74bd2d) | after | change |
|---|---:|---:|---:|
| `rules.md` | 2,595 | 652 | -75% |
| `full.md` | 5,319 | 3,166 | -40% |
| `compact.md` | 1,722 | 1,213 | -30% |
| `tool-description.md` | 1,204 | 213 (fallback only) | -82% |
| full arm, injected text | 9,122 | 4,663 | -49% |
| compact arm, injected text | 5,525 | 2,710 | -51% |

What moved and why:

- The rules state policy only: Nushell only, no handoff, the refusal and hint
  contract, and project scripts run directly. The syntax they used to carry is
  the guide's, and the generic waiting and process discipline is the user's own
  agent instructions, not this bundle's.
- The guide is one file's worth of content in the two variants: the bash and
  PowerShell rewrite block, one pre-send scan, values and tables, control flow,
  files and externals, and the Nushell-specific process and waiting idioms.
- The shell-tool description is the host's text with its shell claims replaced
  (`SDK_REPLACEMENTS`); the bundle's own description is a fallback for a host
  wording the replacements do not recognize. Before, the whole host description
  was replaced, so its contract (`description` argument, sandbox denial, budgets)
  had to be re-stated by hand.
- `test/teaching.test.ts` fails when the rules and the guide repeat a sentence.

## Method

Both versions ran the same 20 cases, two arms (`full`, `compact`), three samples
per case and arm, on both models: DeepSeek `workbuddy-ai/deepseek-v4.1-flash`
(`ds41f`) and GPT-6 Luna. Each version installed into its own profile of one dsh
home, so the executor and guard are identical and only the teaching text
differs. dsh 0.2.1-rc.2, Nushell 0.115.1, concurrency 4.

## Results

| model | version | arm | n | success | first clean | violations | refused | tokens |
|---|---|---|---:|---:|---:|---:|---:|---:|
| ds41f | main | full | 60 | 46 | 59 | 3 | 3 | 3,069,346 |
| ds41f | trim | full | 60 | 49 | 59 | 1 | 1 | 2,408,222 |
| ds41f | main | compact | 60 | 52 | 60 | 0 | 0 | 2,393,070 |
| ds41f | trim | compact | 60 | 51 | 59 | 1 | 1 | 2,336,305 |
| luna | main | full | 60 | 42 | 51 | 4 | 4 | 2,342,146 |
| luna | trim | full | 60 | 47 | 55 | 3 | 3 | 2,491,369 |
| luna | main | compact | 60 | 45 | 55 | 2 | 2 | 2,400,955 |
| luna | trim | compact | 60 | 48 | 58 | 1 | 1 | 2,554,441 |

Refusals in the trim runs: `stderr-redirect` once and `current-item` once for
`ds41f`; four foreign-shell handoffs (`bash -c`) for `luna`. The handoff
refusals are model misses under either prompt, not guidance the trim removed.

## Reading

- No arm regressed beyond sample noise: success moved within ±3 of 60 for
  `ds41f` and up by 3-5 for `luna`, and the refusal count fell or held in three
  of the four arms. The one new refusal is a single `stderr-redirect` in
  `ds41f` compact, where the guide still names the idiom.
- Every arm got this with a prompt roughly half the size. Token totals do not
  track that saving: they follow the number of model turns, so a more successful
  run can spend more tokens. The saving is 4.5 KB of prompt per request.
- This round does not settle the `full` versus `compact` default. The two arms
  stayed within noise of each other (`ds41f` 49 vs 51, `luna` 47 vs 48), so the
  default stays `full` and the decision needs a round with more samples.

## Limits

- Three samples per cell. Per-case success moves by one sample without a
  teaching cause, so only the aggregate is worth reading here.
- The measured prompt differs from the shipped build by one phrase: the bash
  description's "fresh shell" became "fresh process" after these runs. It names
  what a call is, not what to do, and no instruction changed.
- Raw samples and the model patches stay under `.work/`; only this report is
  committed.
