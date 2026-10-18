/**
 * dsh-nu: Nushell as the only shell for DeepSeek Harness.
 *
 * The composition mounts two plugins: the shell executor (which owns the
 * `ctx.shell` provider) and the teaching layer (prompt sections and tool
 * descriptions).
 */

/** The package name, re-exported for diagnostics and tests. */
export const PACKAGE_NAME = 'dsh-nu'
