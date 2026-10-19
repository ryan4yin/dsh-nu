# Why a Nushell-only shell

English | [中文](zh/why.md)

Most shell failures in agent work come from the shell itself. A command prints text, and the next stage has to parse it. A background process has no handle, so the agent waits with a fixed `sleep`. Each tool presents different shell syntax, and the model copies whichever one it saw last.

dsh-nu grew out of the harness rules that tried to contain this. Those rules went through several rounds: use PTC for multi-step work, use Nushell for shell work, use Python for general local processing, never hand a command string to another shell, and never turn a completion wait into a fixed delay.

## The cost of mixed shells

Wrong syntax is the obvious cost. A flag belongs to another shell, a redirect means a comparison, an environment variable uses the wrong prefix. The bigger cost is quieter:

- `ps aux | grep server` often matches the `grep` process itself. `cmd | grep pattern` reports `grep`'s status, so a command that failed can look successful when `grep` finds nothing or matches an error message.
- An agent with a job that finishes in 3 seconds writes `sleep 90`. Another writes `sleep 120` or `sleep 400` for a service that came up in 5 seconds. The number is a guess, so it is either far too long or too short, and a retry loop multiplies the cost.
- `cd` persists. Word splitting and globbing apply after expansion. Quoting rules differ between shells. Pipeline status is whatever the last stage says, so the command "succeeds" while the work it reported on failed.
- The model sees bash in one tool, PowerShell in another, and a shell string in documentation in a third. It copies the most recent one, gets a parse error, and learns to try another shell syntax instead of fixing the command.

## What Nushell changes

Nushell gives the model one execution model instead of several shell syntaxes. Pipelines carry structured values, so `ls | where size > 1mb` filters data and `open --raw file | lines | where { |l| $l =~ "x" }` filters lines. There is one redirection spelling and one variable spelling, with no word splitting or pathname expansion after substitution. Durations are typed, so `sleep 2sec` is explicit, and errors are reported instead of hidden in a silent exit status. Each call is one process, so `cd` and shell variables do not leak between calls; the tool's `workdir` is the working directory contract.

Nushell is a better shell. It is still a shell, and it does not schedule work.

## What dsh-nu adds

- Every shell call becomes `nu --no-config-file -c "<command>"`. The harness never spawns bash or PowerShell for the model.
- A command that would hand work to another shell is refused before a process exists, with the offending statement quoted. The check reads the parse Nushell will execute, so a handoff inside a block, closure, or interpolation is seen instead of missed by a text scan.
- Bash and PowerShell syntax that Nushell rejects or silently misreads is refused with the Nushell spelling to use instead.
- A failure Nushell actually reported gets one line naming the fix.
- The shell tool descriptions, the PTC SDK text, and a short prompt section all describe Nushell, so the tool schema does not keep teaching the old shell syntax.

The test suite runs the rules and hints against the pinned Nushell binary.

## What Nushell does not fix

A shell swap cannot fix agent scheduling. dsh-nu can refuse `bash -c` and teach Nushell syntax, but it cannot tell whether a command has finished, and it should not treat `sleep 90` as a completion signal. That work stays in the harness rules:

- wait for the work itself: the runtime's job wait, `kubectl wait --timeout`, or the process exit;
- make a poll check the condition and exit as soon as it holds;
- give retries and backoff a total time limit, and keep a retry delay to seconds rather than using it as progress;
- keep the producer's exit status when filtering output (`| complete` in Nushell);
- start servers and watchers as background jobs and keep their handles, instead of using `&` plus `ps | grep`.

These are process-management and model-behaviour rules, not syntax. dsh-nu enforces the shell-syntax boundary; the harness enforces waiting and exit-status discipline.

## When not to use dsh-nu

- You need a shell this project does not implement, such as a language runtime that only ships a bash entrypoint. The allowlist and `enforceNushellOnly: false` cover that case, at the cost of the guarantee dsh-nu exists to provide.
- You run a dsh or Nushell version other than the tested pair. The bundle boots with a warning, but the preflight and hints are tuned to the pair.
- You need Windows PowerShell semantics from the model-facing shell tool. The tool name stays `pwsh` on Windows, but the program behind it is Nushell.
