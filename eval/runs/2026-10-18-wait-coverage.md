# Wait and blocking coverage

Date: 2026-10-18

This is the follow-up to the first teaching round. It covers the wait and process
traps seen in real sessions, and it records the limits of that coverage.

## Legacy session audit (hypothesis source)

These sessions predate `dsh-nu` and mostly used a bash or PTC shell. They are a
source of failure hypotheses, not evidence about current Nushell behaviour.
`sleep` is valid in both shells, while `tail -f`, `ps | grep`, and `while true`
are bash shapes whose Nushell behaviour and teaching value are tested by the eval
cases below, not inferred from this corpus.

I scanned 2,369 DSH session logs and parsed 63,119 tool calls. Fixed sleeps are a
repeatable pattern in that legacy corpus, not a one-off:

| signal | count |
|---|---:|
| tool calls containing a sleep | 706 |
| tool calls containing a sleep of at least 30 seconds | 127 |
| sessions with at least one such long sleep | 22 |
| sleep durations of at least 30 seconds | 148 |
| sleep durations of 10-29 seconds | 113 |
| sleep durations of 1-9 seconds | 621 |

The blocking patterns are present too but are harder to attribute without
inspecting each call: `tail -f` appears in 5 tool calls, `ps ... grep` in 10,
and `while true` in 6. The audit is a search, not a claim that every match was a
mistake, and it says nothing about whether the same command is valid Nushell.

## New coverage

Three cases were added to the eval harness:

- `background-wait`: start a two-second job in the background, wait for it, and
  read its output.
- `readiness-wait`: start a two-second service, wait for `ready.txt` to appear,
  then read it.
- `pipeline-status`: run a failing script, keep only its last line, and report
  the exit status.

The grader now records the longest `sleep` in every shell call, rejects a
long fixed sleep when a case sets `maxSleepSeconds`, and counts blocking shapes
(`tail -f`, `watch`, `ps ... grep`, `pgrep`, `while true`).

## Wall time

These are end-to-end sample durations, not pure shell sleep: they include the
model turn and tool overhead. Each wait-case sample used a background call
(`backgroundCalls` = 3 per cell), and no sample recorded a long sleep.

| model | case | full | compact | off |
|---|---|---:|---:|---:|
| GPT-6 Luna | background-wait | 11.4s | 12.8s | 14.1s |
| GPT-6 Luna | readiness-wait | 13.1s | 14.0s | 14.1s |
| GPT-6 Luna | pipeline-status | 6.9s | 5.7s | 8.8s |
| DeepSeek Flash | background-wait | 6.9s | 6.4s | 9.1s |
| DeepSeek Flash | readiness-wait | 8.7s | 8.8s | 9.1s |
| DeepSeek Flash | pipeline-status | 6.6s | 6.1s | 12.5s |

The two-second fixtures finish in roughly 6-14 seconds end to end. The `off`
arm is slower where it has to recover from guard refusals, most clearly on
`pipeline-status`: 8.8s vs 6.9s for GPT-6 Luna and 12.5s vs 6.6s for DeepSeek
Flash. No run waited a fixed 30-120 seconds.

## Results

Three samples per case and arm. `answer` is the expected result; `clean` means
the first shell call passed the guard and dialect preflight.

| model | case | arm | success | clean | refused | long sleep | blocking |
|---|---|---|---:|---:|---:|---:|---:|
| GPT-6 Luna | background-wait | full | 3/3 | 3 | 0 | 0 | 0 |
| GPT-6 Luna | background-wait | off | 3/3 | 3 | 0 | 0 | 0 |
| GPT-6 Luna | readiness-wait | full | 3/3 | 3 | 0 | 0 | 0 |
| GPT-6 Luna | readiness-wait | off | 3/3 | 3 | 0 | 0 | 0 |
| GPT-6 Luna | pipeline-status | full | 3/3 | 3 | 0 | 0 | 0 |
| GPT-6 Luna | pipeline-status | off | 3/3 | 0 | 3 | 0 | 0 |
| DeepSeek Flash | background-wait | full | 3/3 | 3 | 0 | 0 | 0 |
| DeepSeek Flash | background-wait | off | 3/3 | 1 | 2 | 0 | 0 |
| DeepSeek Flash | readiness-wait | full | 3/3 | 3 | 0 | 0 | 0 |
| DeepSeek Flash | readiness-wait | off | 3/3 | 2 | 2 | 0 | 0 |
| DeepSeek Flash | pipeline-status | full | 3/3 | 3 | 0 | 0 | 0 |
| DeepSeek Flash | pipeline-status | off | 3/3 | 0 | 3 | 0 | 0 |

No long sleep or blocking shape appeared in these samples: both models started
the work and used the job or a foreground call, which is the desired outcome.
The metric and the case exist so a regression is visible; this round cannot show
how often a model would otherwise sleep 90 seconds.

## Limits

- Local model not tested.
- The readiness prompt tells the model to start a background job. It tests the
  recovery path but may reduce the chance of a fixed sleep.
- A fixed sleep is not refused: it is a teaching failure, not a safety boundary.
  `sleep` can be legitimate, so the guard must not ban it.
- Process checks still need a behavior case that does not reward `ps | grep`;
  the current round only records the shape in the trace.
