# Teaching evaluation

This directory measures whether the Nushell teaching layer changes model behaviour.
It is a real-model test, not a unit test, and it is deliberately not part of PR CI.

## What it compares

Three arms run the same task with the same executor and guard:

- `full`: the shipped system prompt, rules, guide, and tool descriptions.
- `compact`: the compact guide, rules, and rewritten tool descriptions.
- `off`: `guide: off`, `rules: false`, `rewriteToolDescriptions: false`.

The `off` arm keeps the guard and the dialect preflight. A refusal there is a
teaching failure, not a safety success, so the grader counts it separately.

Each sample records the tool calls, tool results, final answer, token usage, and
whether the task result matched the case expectation. `first clean` means the
first shell command passed the guard and dialect preflight; `violations` counts
all commands that would have been refused. The evaluator imports the same
`findHandoff` and `findHabit` functions the executor uses, so a command that is
flagged here is exactly a command the deployment would refuse.

The grader also records the longest fixed `sleep` in each shell call, flags a
long sleep when a case sets `maxSleepSeconds`, and counts blocking shapes such as
`tail -f`, `watch`, `ps ... grep`, and `while true`. The wait cases are
`background-wait`, `readiness-wait`, and `pipeline-status`.

## Prerequisites

1. Build the bundle: `npm run build`.
2. Use a DSH home that can reach the model and has credentials. Do not commit
   the home, the model patch, or raw samples.
3. Create a profile from the headless template. The runner does this on first
   use and installs the local package with `dsh plugin`:

```sh
export DSH_HOME=/path/to/temporary/dsh-home
dsh --profile dsh-nu-eval --from-default-profile headless --help
```

The runner needs a model patch that selects the model and defines its provider.
For the default DeepSeek route the patch can be only:

```yaml
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: low
```

A self-hosted or gateway route needs its own provider entry in the same patch.
Keep those endpoints out of this public repository.

## Run

```sh
npm run eval -- \
  --dsh-home "$DSH_HOME" \
  --model-patch /path/to/model.yml \
  --dsh dsh \
  --profile dsh-nu-eval \
  --label gpt-6-luna \
  --samples 3 \
  --out .work/eval-runs/gpt-6-luna
```

The runner creates `summary.json` and `summary.md` beside `samples/` and
`workspaces/`. Raw events stay in `--out`; commit only the run summary that the
task needs.

Useful options:

- `--cases json-active,exit-code`: run a subset.
- `--arms full`: skip the baseline.
- `--skip-install`: reuse an already-installed profile.
- `--timeout-ms 300000`: per-sample limit.

## Cross-model scoring

Run the same command for each model into separate output directories, then ask
the other models to score the anonymised samples:

```sh
npm run eval:judge -- \
  --run .work/eval-runs/gpt-6-luna \
  --run .work/eval-runs/deepseek-flash \
  --dsh-home "$DSH_HOME" \
  --model-patch /path/to/judge-model.yml \
  --profile dsh-nu-eval \
  --label gpt-6-luna \
  --out .work/eval-judge/gpt-6-luna
```

Then combine the judge outputs (each judge excludes its own actor):

```sh
npm run eval:cross -- \
  --dir .work/eval-judge/gpt-6-luna \
  --dir .work/eval-judge/deepseek-flash \
  --out .work/eval-cross
```

The judge sees the task, final answer, commands, and results, but not the actor
name or arm. Run one judge per model and compare the means; a judge never scores
its own actor in the summary. Deterministic task success and preflight counts
remain the primary evidence because judge scores are noisy.

## Interpreting a round

- A full arm that succeeds without a refusal is the expected result.
- If `full` has no advantage over `off`, the teaching text is wasting tokens.
  Change the guide or the case; do not just add more rules.
- One sample per cell is directional only. A wording decision needs three
  samples per case and arm, with the per-case counts reported next to the
  aggregate.
- A refusal costs an extra turn and often the task. Track it separately from
  task success.
