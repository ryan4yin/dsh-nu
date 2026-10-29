/**
 * DSH alpha owns model-facing tool schemas in its tool executor. Extend the
 * native executor so the bash/pwsh schemas describe the Nushell shell that
 * actually runs, while leaving every other tool and the execution pipeline
 * unchanged.
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import type { ToolDefinition, ToolModelInput } from '@deepseek-ai/dsh-tools'
import { rewriteToolSchema } from './teaching.js'

/** Plugin name used in loader diagnostics. */
export const name = 'nu-native-tool-executor'

/** Services the plugin needs. */
export const inject = ['tools']

/** The composition entry's config. */
export interface Config {
  rewriteToolDescriptions?: boolean
  toolNames?: string[]
}

/** Loader-visible config schema. */
export const Config = z.object({
  rewriteToolDescriptions: z.boolean().default(true),
  toolNames: z.array(z.string()).default(['bash', 'pwsh']),
})

/** Normalized options used at runtime. */
export interface Options {
  rewriteToolDescriptions: boolean
  toolNames: string[]
}

/** Validate the config eagerly so a typo fails at boot. */
export function normalizeConfig(config: unknown = {}): Options {
  if (config !== null && typeof config !== 'object') throw new Error('dsh-nu: native executor config must be an object')
  const source = (config ?? {}) as { rewriteToolDescriptions?: unknown; toolNames?: unknown }
  if (source.rewriteToolDescriptions !== undefined && typeof source.rewriteToolDescriptions !== 'boolean') {
    throw new Error('dsh-nu: native executor rewriteToolDescriptions must be a boolean')
  }
  const toolNames = source.toolNames ?? ['bash', 'pwsh']
  if (!Array.isArray(toolNames) || !toolNames.every((entry) => typeof entry === 'string')) {
    throw new Error('dsh-nu: native executor toolNames must be an array of strings')
  }
  return { rewriteToolDescriptions: source.rewriteToolDescriptions !== false, toolNames: [...toolNames] }
}

/** Native executor with the shell-tool descriptions rewritten into Nushell terms. */
export class NuNativeToolExecutor extends NativeToolExecutor {
  readonly #options: Options

  constructor(ctx: Context, options: Options) {
    super(ctx)
    this.#options = options
  }

  override describe(tools: readonly ToolDefinition[]): ToolModelInput {
    const described = super.describe(tools)
    if (!this.#options.rewriteToolDescriptions) return described
    return {
      ...described,
      schemas: described.schemas.map((schema) => rewriteToolSchema(schema, this.#options.toolNames) as ToolModelInput['schemas'][number]),
    }
  }
}

/** Replace the base native executor with the Nushell-description variant. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.tools.setExecutor(new NuNativeToolExecutor(ctx, normalizeConfig(config)))
}
