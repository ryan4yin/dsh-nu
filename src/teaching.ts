/**
 * The teaching layer: prompt sections and honest shell-tool descriptions.
 *
 * It mounts beside the executor and uses documented seams only:
 *
 * 1. systemPrompt.section for the mandatory rules and the syntax guide;
 * 2. a system-prompt/assemble listener that rewrites the bash/pwsh tool
 *    descriptions and their command parameter into Nushell terms;
 * 3. the same listener rewrites the generated PTC "tools:sdk" section, because
 *    that repository-rendered text comes from the tool registry and never
 *    passes through the assembled tool array.
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { buildGuide, buildRules, buildToolDescription, NUSHELL_COMMAND_DESCRIPTION } from './guide.js'
import type { GuideVariant } from './guide.js'
import { nuFacts } from './nu.js'

/** The prompt section holding the mandatory shell rules. */
export const RULES_SECTION = 'nu:rules'

/** The prompt section holding the syntax guide. */
export const GUIDE_SECTION = 'nu:guide'

/** The section dsh-tools renders the PTC SDK declarations into. */
export const SDK_SECTION = 'tools:sdk'

/** The plugin name used in loader diagnostics. */
export const name = 'nu-teaching'

/** Services the plugin needs. */
export const inject = ['systemPrompt']

/** The composition entry's config. */
export interface Config {
  guide?: GuideVariant
  rules?: boolean
  rewriteToolDescriptions?: boolean
  toolNames?: string[]
}

/** Loader-visible config schema. */
export const Config = z.object({
  guide: z.string().default('full'),
  rules: z.boolean().default(true),
  rewriteToolDescriptions: z.boolean().default(true),
  toolNames: z.array(z.string()).default(['bash', 'pwsh']),
})

/** Normalized options used at runtime. */
export interface Options {
  guide: GuideVariant
  rules: boolean
  rewriteToolDescriptions: boolean
  toolNames: string[]
}

/** Validate the config eagerly so a typo fails at boot. */
export function normalizeConfig(config: unknown = {}): Options {
  if (config !== null && typeof config !== 'object') throw new Error('dsh-nu: teaching config must be an object')
  const source = (config ?? {}) as { guide?: unknown; rules?: unknown; rewriteToolDescriptions?: unknown; toolNames?: unknown }
  const guide = source.guide ?? 'full'
  if (guide !== 'full' && guide !== 'compact' && guide !== 'off') throw new Error('dsh-nu: teaching guide must be one of full, compact, off')
  if (source.rules !== undefined && typeof source.rules !== 'boolean') throw new Error('dsh-nu: teaching rules must be a boolean')
  if (source.rewriteToolDescriptions !== undefined && typeof source.rewriteToolDescriptions !== 'boolean') {
    throw new Error('dsh-nu: teaching rewriteToolDescriptions must be a boolean')
  }
  const toolNames = source.toolNames ?? ['bash', 'pwsh']
  if (!Array.isArray(toolNames) || !toolNames.every((entry) => typeof entry === 'string')) {
    throw new Error('dsh-nu: teaching toolNames must be an array of strings')
  }
  return {
    guide,
    rules: source.rules !== false,
    rewriteToolDescriptions: source.rewriteToolDescriptions !== false,
    toolNames: [...toolNames],
  }
}

/** The structural section shape this layer reads. */
interface Section {
  name: string
  text: string
  [key: string]: unknown
}

/** The structural assembly shape this layer reads. */
interface Assembly {
  tools?: unknown[] | undefined
  sections?: Section[] | undefined
  [key: string]: unknown
}

/** The structural tool schema shape this layer reads. */
interface ToolSchema {
  name?: unknown
  description?: unknown
  parameters?: { properties?: Record<string, { description?: unknown }> } | undefined
  [key: string]: unknown
}

/** Whether a description claims to run bash or PowerShell. */
function claimsForeignShell(description: string): boolean {
  return /\bbash\b|\bpwsh\b|PowerShell/i.test(description)
}

/** Rewrite one tool schema, leaving unrelated tools untouched. */
function rewriteTool(raw: unknown, options: Options): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const tool = raw as ToolSchema
  if (typeof tool.name !== 'string' || !options.toolNames.includes(tool.name)) return raw
  const original = typeof tool.description === 'string' ? tool.description : ''
  if (!claimsForeignShell(original)) return raw
  // Keep the host's contract and swap only its shell claims; an unrecognized
  // host wording falls back to the bundle's own description.
  const edited = rewriteSdkText(original)
  const rewritten: ToolSchema = { ...tool, description: claimsForeignShell(edited) ? buildToolDescription() : edited }
  const command = tool.parameters?.properties?.command
  if (command !== undefined && tool.parameters?.properties !== undefined) {
    rewritten.parameters = {
      ...tool.parameters,
      properties: { ...tool.parameters.properties, command: { ...command, description: NUSHELL_COMMAND_DESCRIPTION } },
    }
  }
  return rewritten
}

/** Host shell claims in tool descriptions and the generated PTC SDK text, rewritten into Nushell terms. */
const SDK_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Execute a bash command/gi, 'Execute a Nushell command'],
  [/Execute a PowerShell command/gi, 'Execute a Nushell command'],
  [/The bash command to execute\./gi, NUSHELL_COMMAND_DESCRIPTION],
  [/The PowerShell command to execute\./gi, NUSHELL_COMMAND_DESCRIPTION],
  [/The bash command to execute/gi, NUSHELL_COMMAND_DESCRIPTION],
  [/The PowerShell command to execute/gi, NUSHELL_COMMAND_DESCRIPTION],
  [/bash -c/gi, 'nu --no-config-file -c'],
  [/pwsh -Command/gi, 'nu --no-config-file -c'],
  [/Bash shell/gi, 'Nushell'],
  [/PowerShell shell/gi, 'Nushell'],
  // Host-shell claims in the generated descriptions that the terms above miss.
  [/An unset variable expands to an empty string, so guard variables in such paths with `\$\{VAR:\?\}`\./g, 'Reading an unset variable with `$env.NAME` is an error; read `$env.NAME?` and check for null before using it in a path.'],
  [/Do not assign to automatic variables such as `\$HOME`; variable names are case-insensitive, so `\$home` is the same read-only variable\./g, 'Variable names are case-sensitive.'],
  [/Under the Windows sandbox, read-only pwsh runs in PowerShell ConstrainedLanguage mode[\s\S]*?core cmdlets work\. /g, ''],
  [/fresh pwsh process/gi, 'fresh Nushell process'],
  // The bash description says "fresh shell"; a nu -c call is a fresh process.
  [/fresh shell/gi, 'fresh process'],
  [/PowerShell's own pipelines/gi, "Nushell's own pipelines"],
  [/\$env:/g, '$env.'],
  // Nushell reads environment values under $env, never as bare $NAME.
  [/`\$DSH_\*`/g, '`$env.DSH_*`'],
]

/** Rewrite host shell-tool text (a tool description or the PTC SDK section); idempotent. */
export function rewriteSdkText(text: string): string {
  let output = text
  for (const [pattern, replacement] of SDK_REPLACEMENTS) output = output.replace(pattern, replacement)
  return output
}

/** Rewrite the generated SDK section in place, if present. */
function rewriteSdkSections(sections: Section[]): Section[] {
  let changed = false
  const rewritten = sections.map((section) => {
    if (section.name !== SDK_SECTION) return section
    const next = rewriteSdkText(section.text)
    if (next === section.text) return section
    changed = true
    return { ...section, text: next }
  })
  return changed ? rewritten : sections
}

/** The part of the systemPrompt service this layer uses. */
interface SystemPromptLike {
  section: (spec: { name: string; order: number; text: string | (() => string) }) => void
  getSectionOrder?: (placement: string) => number | undefined
}

/** The part of the cordis context this layer uses. */
interface TeachingContext {
  systemPrompt: SystemPromptLike
  on: (event: string, listener: (assembly: Assembly, context: unknown, next: () => Promise<Assembly>) => Promise<Assembly>) => void
  logger?: { info: (message: string) => void }
}

/** The plugin entry point, with loader-visible metadata attached. */
export interface TeachingPlugin {
  (ctx: Context, config?: Config): void
  inject: string[]
}

/** Apply the teaching layer. */
export function apply(rawContext: Context, config: Config = {}): void {
  const ctx = rawContext as unknown as TeachingContext
  const options = normalizeConfig(config)
  const base = ctx.systemPrompt.getSectionOrder?.('TOOL_BASH') ?? 1000

  if (options.rules) ctx.systemPrompt.section({ name: RULES_SECTION, order: base, text: buildRules() })
  if (options.guide !== 'off') {
    ctx.systemPrompt.section({ name: GUIDE_SECTION, order: base + 1, text: () => buildGuide({ variant: options.guide, version: nuFacts.version }) })
  }

  if (options.rewriteToolDescriptions) {
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      if (result === null || typeof result !== 'object') return result
      const tools = Array.isArray(result.tools) ? result.tools.map((tool) => rewriteTool(tool, options)) : undefined
      const sections = Array.isArray(result.sections) ? rewriteSdkSections(result.sections) : result.sections
      if (tools === undefined) return sections === result.sections ? result : { ...result, sections }
      return sections === result.sections ? { ...result, tools } : { ...result, tools, sections }
    })
  }

  try {
    ctx.logger?.info('dsh-nu: teaching Nushell (guide: ' + options.guide + ', tool descriptions: ' + (options.rewriteToolDescriptions ? 'rewritten' : 'untouched') + ')')
  } catch {
    // Logging is best-effort.
  }
}

/** The plugin, with the injection declaration the bare-package mount reads. */
export const teaching: TeachingPlugin = Object.assign(apply, { inject })

export default teaching
