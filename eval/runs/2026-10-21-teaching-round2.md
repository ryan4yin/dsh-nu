# Teaching round 2: the refusal surface and the lines that cut retries

Date: 2026-10-21. Branch `teaching-round2` against `main` at `6464231`.

## Why a second round

The 2026-10-21 trim measured prompt size and the 20-case suite, but the suite
is weighted to Nushell data fluency (tables, paths, jobs, exit codes) and barely
touches the bash-shaped commands real sessions still write. A scan of the two
days before this round found the misses.

## What the sessions show

102 of the 318 recent real sessions had at least one failed tool result, and all
of them ran this bundle. Refusals over that window, by rule:

| rule | count |
| --- | --- |
| `stderr-as-word` (`2>/dev/null`) | 39 |
| `stderr-redirect` (`2>&1`) | 34 |
| `stderr-file` (`2> err.txt`) | 15 |
| `stdin-redirect` (`cmd < in.txt`) | 10 |
| `command-substitution` (`$(cmd)`) | 8 |
| `stdout-redirect` (`cmd > out.txt`) | 6 |
| `and-or` (`&&`, `\|\|`) | 5 |
| `powershell-cmdlet` | 4 |
| `guard: sh` | 4 |
| `bash-flag` (`mkdir -p`) | 4 |
| `comma-column` (`select name, size`) | 3 |
| `bare-assignment` (`$x = 1`) | 3 |
| `guard: bash` | 2 |
| `pipe-redirect`, `array-literal` | 1 each |

Nushell's own failures in the same window (293) cluster differently:
`unknown_flag` 48, `external_command` 34, `parse_mismatch` 33, `io::not_found`
32, `permission_denied` 21, `only_supports_this_input_type` 21 (mostly `$env`
filtered like a table), `deprecated` 12 (`filter`), `column_not_found` 10,
`unbalanced_delimiter` 12.

The suite covered 3 of those 15 refusal rules. This round adds six cases for the
top uncovered forms and adds the guide lines the Nushell failures point at.

## Changes

`src/guides/full.md` (+898 bytes), `src/guides/compact.md` (+583), each line
backed by an executable claim in `test/claims.test.ts`:

- Paths: `ls **/* | where type == file | get name` gives cwd-relative paths;
  `glob` gives absolute strings and takes no `--type` / `--directory` flag.
- `complete` wraps one external command (`(do { ^cmd } | complete).exit_code`);
  a builtin needs `try { } catch { }`.
- A caret is a command-position spelling: `^xargs -0 rg`, not `xargs ^rg`.
- A script without an execute bit needs `chmod +x` first.
- `$env` is a record (`$env | transpose key value`), not a table.
- `date now | format date '%Y-%m-%d'` replaces `date -u +FORMAT`.
- A `mut` variable keeps its first value's type, so `mut x = null` cannot later
  hold a record.

`eval/cases.json` gains six cases for the uncovered refusal forms:
`stderr-to-file`, `stdin-file`, `capture-substitution`, `conditional-chain`,
`stdout-to-file`, `explicit-bash`.

## Results

Local model (llama-swap `Qwen3.8-Flash-Next-IQ3_S-ista-text`), nine error-prone
cases, `full` arm, three samples per cell (27 each), two rounds = two GPUs, one
request each:

| | main | this branch |
| --- | --- | --- |
| task success | 18/27 | 21/27 |
| answer matched | 27/27 | 27/27 |
| Nushell hints | 21 | 7 |
| shell calls | 77 | 52 |
| tokens | 1.65M | 1.28M |

Per case (pass of 3, `main` -> branch): `proc-inspect` 2->3, `recursive-list`
2->3, `project-script` 2->3, `deep-mkdir` 1->2, `exit-code` 3->3 (calls 6->3),
`search-ignore` 2->1, `chain-step` 0->0. A targeted rerun after the `mut` line:
`chain-step` 1/3, `deep-mkdir` 3/3.

The six new refusal cases on the branch: 15/18 pass, no refusals — the model
already wrote the Nushell form for four of them, so they now protect the
behaviour instead of only the refusal.

DeepSeek v4.1 Flash on the same fifteen cases, 45 samples: 37 pass, 43 answers
matched, 6 hints, 1 refusal. Per case it fails only where the local model does:
`chain-step` 0/3, `pipeline-status`, `recursive-list`, `project-script`,
`stderr-to-file`, and `stdout-to-file` 2/3 each. The six new cases pass 15/18 on
the local model and 17/18 on Flash, so they cover behaviour rather than only the
refusal path.

## Reading

Every fail in the local round was a call-budget overrun with a correct answer,
never a wrong answer: the remaining cost is retries, not mistakes. Hints fell
by two thirds and calls by a third, which is the guidance doing its job at the
moment of failure.

`chain-step` and `search-ignore` still thrash: the model writes its own
recursion or invents `set` before settling. That is model behaviour, not a
missing line, and the next lever would be a case-level call budget or a
different model, not more prompt text.

## Limits

Three samples per cell is directional. One branch round and one targeted rerun
are not enough to claim the per-case deltas are stable; `search-ignore` moving
2->1 is inside that noise. The local model serves two requests at a time, so
runs were serialised to two workers.
