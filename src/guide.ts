/**
 * Model-facing prose: mandatory shell rules, a Nushell syntax guide, and the
 * rewritten shell-tool descriptions. The prose lives in `src/guides/*.md`
 * and is copied into `dist/guides` by the build.
 */

import { readFileSync } from 'node:fs'

/** Guide variants the config accepts. */
export type GuideVariant = 'full' | 'compact' | 'off'

/** Options for {@link buildGuide}. */
export interface GuideOptions {
  variant?: GuideVariant
  version?: string | undefined
}

function readGuide(name: string): string {
  return readFileSync(new URL('./guides/' + name, import.meta.url), 'utf8').trimEnd()
}

const RULES = readGuide('rules.md')
const FULL_GUIDE = readGuide('full.md')
const COMPACT_GUIDE = readGuide('compact.md')
const TOOL_DESCRIPTION = readGuide('tool-description.md')

/** The short mandatory section: rules a shell call must not break. */
export function buildRules(): string {
  return RULES
}

/** The full syntax guide, or its compact form. */
export function buildGuide(options: GuideOptions = {}): string {
  const variant = options.variant ?? 'full'
  if (variant === 'off') return ''
  const text = variant === 'compact' ? COMPACT_GUIDE : FULL_GUIDE
  if (options.version === undefined) return text
  return text.replace(/^Nushell syntax guide/, 'Nushell syntax guide (Nushell ' + options.version + ')')
}

/** Options for {@link buildToolDescription}. */
export interface ToolDescriptionOptions {
  /** @deprecated Ignored: both shell tools share one description. */
  tool?: string
}

/** The model-facing description of a shell tool, in Nushell terms. */
export function buildToolDescription(_options: ToolDescriptionOptions = {}): string {
  return TOOL_DESCRIPTION
}

/** The command parameter description shared by both shell tools. */
export const NUSHELL_COMMAND_DESCRIPTION = 'The Nushell command to execute (Nushell syntax; not bash or PowerShell).'
