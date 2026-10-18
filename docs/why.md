# Why a Nushell-only shell

English | [中文](zh/why.md)

A shell is not just a command runner. It is a text protocol with hidden state,
and a coding agent pays for every sharp edge in that protocol with wasted turns.
This bundle exists because "just use bash" kept producing the same failure
classes.

## Mixed shells are a failure mode

The obvious cost is wrong syntax: a flag belongs to another shell, a redirect
means a comparison, an environment variable uses the wrong prefix. The expensive
cost is quieter:

- **Text where data should be.** `ps aux | grep server` often matches the
  `grep` process itself; `cmd | grep pattern` reports `grep`'s status, so a
  command that failed can look successful when `grep` finds nothing or matches
  an error message.
- **Guessing at completion with a fixed sleep.** An agent that has a 3-second
  job writes `sleep 90` and waits. Another writes `sleep 120` or `sleep 400`
  for a service that came up in 5 seconds. The number is a guess, so it is
  either 30 times too long or too short, and a retry loop multiplies the cost.
  A sleep is not a synchronization primitive.
- **Hidden state and quiet success.** `cd` persists, word splitting and globbing
  apply after expansion, quoting rules differ between shells, and pipeline
  status is whatever the last stage says. The command "succeeds" while the work
  it reported on failed.
- **A moving dialect.** The model sees bash in one tool, PowerShell in another,
  and a shell string inside documentation in a third. It copies the most recent
  one, gets a parse error, and learns to try another dialect instead of fixing
  the command.

That is why the harness rules went through several iterations: prefer PTC for
multi-step work, use Nushell for shell work, use Python for general local
processing, never hand a command string to another shell, and never turn a
completion wait into a fixed delay.

## What Nushell changes

Nushell gives the model one execution model instead of a family of dialects:

- pipelines carry structured values, not formatted text; `ls | where size > 1mb`
  filters data and `open --raw file | lines | where { |l| $l =~ "x" }` filters
  lines;
- one redirection spelling and one variable spelling, with no word splitting or
  pathname expansion after substitution;
- typed durations (`sleep 2sec`) and explicit errors instead of a silent exit
  status;
- one process per call, so `cd` and shell variables do not leak between calls.
  The tool call's `workdir` is the working directory contract.

Nushell is a better shell. It is still a shell, not a scheduler.

## What this bundle adds

- **One executor.** Every shell call becomes `nu --no-config-file -c "<command>"`;
  the harness never spawns bash or PowerShell for the model.
- **A guard.** A command that would hand work to another shell is refused before
  a process exists, with the offending statement quoted.
- **A dialect preflight.** Bash and PowerShell habits that fail in Nushell are
  refused with the Nushell spelling that replaces them.
- **Hints.** A failure Nushell actually reported gets one actionable line that
  names the fix.
- **Teaching.** The shell tool descriptions, the PTC SDK text, and a short
  prompt section all describe Nushell, so the model is not taught the old
  dialect by the tool schema.

The rules and the hints are tested against the actual behaviour of the pinned
Nushell version; they are not guesses about what Nushell probably does.

## What Nushell does not fix

A shell swap cannot fix agent scheduling. The bundle can refuse `bash -c` and
teach Nushell syntax, but it cannot tell whether a command has finished, and it
should not pretend that `sleep 90` is a completion signal. The harness rules
still have to do that work:

- await the work's own completion — the runtime's job wait, `kubectl wait
  --timeout`, or the process exit — instead of sleeping before a check;
- make any poll check the condition and exit as soon as it holds;
- bound retries and backoff with a total time limit, and keep a retry delay to
  seconds, never a progress wait;
- keep the producer's exit status when filtering output (`| complete` in
  Nushell);
- start servers and watchers as background jobs and keep their handles, not as
  `&` plus `ps | grep`.

Those are process-management and model-behaviour rules, not syntax. The shell
bundle enforces the dialect boundary; the harness rules enforce the waiting and
status discipline.

## When this is not for you

- You need a shell that this project does not implement (a language runtime that
  only ships a bash entrypoint, for example). The allowlist and
  `enforceNushellOnly: false` exist for that case, but they give up the
  guarantee the bundle is for.
- You run a dsh or Nushell version other than the tested pair. The bundle boots
  with a warning, but the dialect rules and hints are tuned to the pinned pair.
- You need Windows PowerShell semantics from the model-facing shell tool. The
  tool name stays `pwsh` on Windows, but the program behind it is Nushell.
