/**
 * Deprecated compatibility shim for the former dialect module.
 *
 * Import from `./syntax.js` instead. This module keeps the old path and names
 * working for one release; the aliases are removed in 0.4.0.
 */

export * from './syntax.js'
export {
  assertNushellSyntax as assertNuDialect,
  findSyntaxIssue as findHabit,
} from './syntax.js'
export type { SyntaxOptions as DialectOptions } from './syntax.js'
