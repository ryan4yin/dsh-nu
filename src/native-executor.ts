/**
 * DSH alpha owns model-facing tool schemas in its tool executor. Extend the
 * native executor so the bash/pwsh schemas describe the Nushell shell that
 * actually runs, while leaving every other tool and the execution pipeline
 * unchanged.
 */

import type { Context } from '@deepseek-ai/cordis'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import type { ToolDefinition, ToolModelInput } from '@deepseek-ai/dsh-tools'
import { normalizeConfig, rewriteToolSchema, type Options } from './teaching.js'

/** Plugin name used in loader diagnostics. */
export const name = 'nu-native-tool-executor'

/** Services the plugin needs. */
export const inject = ['tools']

/** Native executor with the shell-tool descriptions rewritten into Nushell terms. */
class NuNativeToolExecutor extends NativeToolExecutor {
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
      schemas: described.schemas.map((schema) => rewriteToolSchema(schema, this.#options) as ToolModelInput['schemas'][number]),
    }
  }
}

/** Replace the base native executor with the Nushell-description variant. */
export function apply(ctx: Context): void {
  ctx.tools.setExecutor(new NuNativeToolExecutor(ctx, normalizeConfig({})))
}
