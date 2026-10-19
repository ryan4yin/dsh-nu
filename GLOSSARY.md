# dsh-nu

A deployment that runs every agent shell command in Nushell and refuses handoffs to other shells. This glossary fixes the words used in the README, the ADRs, and the failure messages.

## Enforcement

**Preflight**:
The checks that run before a shell call spawns: the guard and the syntax rules. A command that fails either check never starts a process.
_Avoid_: syntax preflight (for the whole), lint, validation

**Guard**:
The preflight half that refuses a handoff.
_Avoid_: scanner, shell detector, filter

**Handoff**:
A command position where a Nushell call would hand execution to a foreign shell, directly or through a launcher.
_Avoid_: hand-off, shell-out, delegation, escape

**Foreign shell**:
A shell other than Nushell, such as bash, zsh, fish, PowerShell, or cmd.
_Avoid_: other shell, non-Nushell shell, target shell

**Launcher**:
A program in the guard's fixed table that runs another program named in its own arguments, such as `env`, `sudo`, `timeout`, or `xargs`.
_Avoid_: wrapper, prefix, trampoline

**Wrapper chain**:
The run of launchers in front of the program that actually executes, as in `env timeout 5 bash`.
_Avoid_: launcher chain, command prefix

**Syntax rule**:
A preflight refusal for bash or PowerShell syntax that Nushell rejects or quietly misreads, paired with the Nushell spelling to use instead.
_Avoid_: dialect, dialect rule, dialect habit, lint rule, syntax error

**Silent misbehaviour**:
A bash or PowerShell form that Nushell accepts with no error while doing something other than what the form means in its original shell.
_Avoid_: silent misread, silent failure, quiet no-op, false success

**Allowlist**:
Whole-command patterns that exempt a command from the preflight, for a call site that genuinely needs a foreign shell.
_Avoid_: whitelist, exceptions list, bypass list

**Enforcement boundary**:
The line between handoffs the guard can refuse and executions it cannot see, such as a shell name computed at run time or a program that starts a shell itself.
_Avoid_: sandbox, guarantee, security boundary

## Failure feedback

**Hint**:
The one-line `Nushell hint (<id>):` message appended to a failed shell call when Nushell reports an error, naming one fix.
_Avoid_: suggestion, tip, advice

## Support

**Tested pair**:
The one dsh and Nushell version combination a release is tested against.
_Avoid_: supported range, version window, compatibility range
