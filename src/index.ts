/**
 * dsh-nu: Nushell as the only shell for DeepSeek Harness.
 *
 * The composition mounts the shell executor (which owns the `ctx.shell`
 * provider), the bash/pwsh tool rows (dsh's shell tools with Nushell
 * descriptions), and the teaching layer (prompt sections and the PTC SDK
 * text).
 */

/** The package name, re-exported for diagnostics and tests. */
export const PACKAGE_NAME = 'dsh-nu'
