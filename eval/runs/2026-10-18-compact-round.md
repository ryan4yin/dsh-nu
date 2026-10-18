# Compact arm round

Date: 2026-10-18

The first round compared `full` and `off`; this round adds the shipped
`compact` guide. It runs the same nine cases with the same two models, three
samples per case and arm: 27 samples per arm and model.

## Results

Tokens are the sum of all model calls in the arm. Strict success requires the
expected answer, the case call budget, and no long fixed sleep.

| model | arm | success | answer | violations | refused | tokens |
|---|---|---:|---:|---:|---:|---:|
| GPT-6 Luna | full | 26/27 | 27/27 | 0 | 0 | 1,320,724 |
| GPT-6 Luna | compact | 26/27 | 26/27 | 0 | 0 | 1,280,105 |
| GPT-6 Luna | off | 25/27 | 27/27 | 13 | 13 | 1,481,944 |
| DeepSeek Flash | full | 26/27 | 27/27 | 0 | 0 | 1,391,981 |
| DeepSeek Flash | compact | 27/27 | 27/27 | 0 | 0 | 1,199,553 |
| DeepSeek Flash | off | 22/27 | 27/27 | 21 | 21 | 1,592,212 |

No arm produced a long sleep or a blocking shape in these samples.

## Reading

- Both guided arms had zero guard refusals; the `off` arm had 13 and 21.
- Compact matched or beat full task success. It used 3% fewer tokens for GPT-6
  Luna and 14% fewer for DeepSeek Flash.
- GPT-6 Luna's one compact strict failure was a Markdown answer that returned
  absolute paths. The result was semantically correct but did not match the
  expected relative-path format; that is a grader strictness issue, not a shell
  failure.
- Three samples per cell are directional. Compact is viable, but one round does
  not justify changing the default from `full`.

The compact arm also exercises the same wait and redirection cases as the wait
round; see [`2026-10-18-wait-coverage.md`](./2026-10-18-wait-coverage.md).
