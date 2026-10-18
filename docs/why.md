# Why a Nushell-only shell

English | [中文](zh/why.md)

## The problem with mixed shells

A coding agent that can start bash, zsh, fish, and PowerShell tends to write the
dialect it saw most recently. The result is a command that looks plausible and
fails for a reason the model cannot see: a flag belongs to another shell, a
redirect means a comparison, an environment variable uses the wrong syntax.
The tool output then teaches the model to try a different dialect instead of
fixing the command.

## What Nushell changes

Nushell has one execution model: a command runs as one process, pipelines carry
structured values, and redirection, variables, and control flow have one
spelling each. That removes the guesswork about which shell a snippet belongs
to. It also gives the model useful structure: `ls | where size > 1mb` works
on data, not on formatted text.

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

## When this is not for you

- You need a shell that this project does not implement (a language runtime that
  only ships a bash entrypoint, for example). The allowlist and
  `enforceNushellOnly: false` exist for that case, but they give up the
  guarantee the bundle is for.
- You run a dsh or Nushell version other than the tested pair. The bundle boots
  with a warning, but the dialect rules and hints are tuned to the pinned pair.
- You need Windows PowerShell semantics from the model-facing shell tool. The
  tool name stays `pwsh` on Windows, but the program behind it is Nushell.
