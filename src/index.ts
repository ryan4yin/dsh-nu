/**
 * dsh-nu: Nushell as the only shell for DeepSeek Harness.
 *
 * The composition mounts three plugins: the shell executor (which owns the
 * `ctx.shell` provider), the native tool executor (which rewrites the shell
 * tool schemas), and the teaching layer (prompt sections and the PTC SDK
 * text).
 */

/** The package name, re-exported for diagnostics and tests. */
export const PACKAGE_NAME = 'dsh-nu'
