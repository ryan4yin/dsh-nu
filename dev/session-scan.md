# Local session baseline scanner

[session-scan.mjs](session-scan.mjs) aggregates explicitly supplied files. It reads JSONL events emitted by DSH's `--json` mode, or sample JSON envelopes written by [eval/run.mjs](../eval/run.mjs), whose `stdout` contains those events. It does not discover sessions, traverse directories, run commands, or modify inputs.

From the repository root:

```text
node dev/session-scan.mjs events.jsonl
node dev/session-scan.mjs sample.json
node dev/session-scan.mjs events.jsonl sample.json
node dev/session-scan.mjs --help
```

Paths beginning with `-` need a `./` prefix. Output is one JSON aggregate with counts and restricted ID tokens; it contains no filenames, commands, call IDs, session IDs, or result excerpts. Errors identify the input's argument number and, where available, line number, without echoing input text or filesystem errors. Malformed JSON, malformed tool events, duplicate call/result IDs within a file, and unreadable or non-regular files exit 1 without a partial aggregate. Empty streams are valid and contribute zero events.

## Counts and denominators

| Field | Meaning and denominator |
| --- | --- |
| `inputs` | Number of supplied files, split into JSONL streams and eval sample envelopes. |
| `totals` | All events and tool calls/results; shell calls/results count only `bash` and `pwsh`. Results are joined to calls by `callId` within each input. Missing shell results and unmatched tool results are reported separately. |
| `exits` | Shell results split into explicit zero, explicit nonzero, and unknown exit status. These three counts sum to `totals.shellResults`. |
| `failed` | Known nonzero shell results with and without any recognized hint. The denominator for the without-hint fraction is `exits.failed`; unknown exits are excluded. A zero denominator means no observation, not 0% failure. |
| `refusals` | Shell results containing a refusal banner. `ids` counts explicit syntax rule IDs; `withoutId` includes foreign-shell refusals without a rule ID. Denominator: `totals.shellResults`. |
| `hints`, `nuDiagnostics` | Shell results containing hint banners or `Error: nu::…` / `Warning: nu::…` headers, plus counts by ID. Each ID counts at most once per result. Different IDs can occur in one result, so ID totals may exceed result totals. Denominator: `totals.shellResults`. |
| `deprecations` | Shell results containing `Warning: nu::parser::deprecated`, split by presence of a `deprecated-flag` hint. Visibility is `withHint / results`. An unrelated error hint does not count as a deprecation hint. |

Only a final `[exit code: N]` marker establishes exit status. DSH often omits the marker on success; those results remain unknown here. Tool event `status` and the envelope's DSH process `status` are not shell exit codes. Refusals, timeouts, signals, and background launches without an exit marker also remain unknown. Calls without results are not included in exit counts.

## Limits

These are observations of rendered banners, not an independent diagnosis. Truncated output can lose markers; output that deliberately imitates banners can be counted. ANSI control sequences are removed before matching. IDs are restricted to bounded lowercase ASCII tokens; invalid tokens are ignored. A deprecation warning with an actual error may intentionally receive only an error hint, so `withoutHint` is not automatically a defect.

Inputs are independent runs: call IDs are never joined across files, and passing the same data twice counts it twice. Non-shell tools, including later `job_output` results and shell activity hidden inside an outer tool result, are excluded from shell metrics. The scanner reads one file into memory at a time and supports the current string-valued DSH tool result format. Eval envelope fields other than `stdout` are ignored.

The scanner does not infer retries, repair success, task success, or automatic correction. No production baseline is bundled; use explicit evaluation fixtures for comparisons. The CLI forms and failure behavior are exercised in [session-scan.test.ts](../test/session-scan.test.ts).
