/**
 * The bash/pwsh tool rows, re-mounted with Nushell descriptions.
 *
 * DSH alpha hands tool schemas to the model from the tool registry, through
 * whichever executor the profile selects: native function calls or the PTC
 * SDK. These rows run the upstream tool plugin unchanged and rewrite only the
 * definition it registers, so every executor reads the same Nushell text and
 * the tool name the model sees stays "bash"/"pwsh".
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { rewriteToolSchema } from './teaching.js'

/** The part of an upstream tool plugin this wrapper calls. */
export interface UpstreamToolPlugin {
  inject: unknown
  Config: z<object>
  apply: (ctx: Context, config?: object) => void
}

/** The wrapper's own config, beside the upstream tool's. */
export interface Config {
  rewriteToolDescriptions?: boolean
  [key: string]: unknown
}

/** The plugin entry the bundle patch mounts. */
export interface ShellToolPlugin {
  inject: unknown
  Config: z<Config>
  apply: (ctx: Context, config?: Config) => void
}

/** The registry seam the wrapper intercepts. */
interface ToolsLike {
  register: (definition: unknown, options?: unknown) => () => void
}

/** Forward every property to the target, keeping methods bound to it. */
function forward<T extends object>(target: T, key: string | symbol): unknown {
  const value = Reflect.get(target, key, target)
  return typeof value === 'function' ? value.bind(target) : value
}

/** A context whose tool registrations carry the Nushell description. */
export function rewritingContext(ctx: Context, toolName: string): Context {
  const tools = (ctx as unknown as { tools: ToolsLike }).tools
  const register = (definition: unknown, options?: unknown) => tools.register(rewriteToolSchema(definition, [toolName]), options)
  const rewritingTools = new Proxy(tools, { get: (target, key) => (key === 'register' ? register : forward(target, key)) })
  return new Proxy(ctx, { get: (target, key) => (key === 'tools' ? rewritingTools : forward(target, key)) })
}

/** Build the plugin that mounts an upstream shell tool under Nushell text. */
export function shellTool(upstream: UpstreamToolPlugin, toolName: string): ShellToolPlugin {
  const Config = z.intersect([upstream.Config, z.object({ rewriteToolDescriptions: z.boolean().default(true) })]) as z<Config>
  function apply(ctx: Context, config: Config = {}): void {
    const { rewriteToolDescriptions, ...rest } = config ?? {}
    if (rewriteToolDescriptions !== undefined && typeof rewriteToolDescriptions !== 'boolean') {
      throw new Error('dsh-nu: ' + toolName + ' rewriteToolDescriptions must be a boolean')
    }
    upstream.apply(rewriteToolDescriptions === false ? ctx : rewritingContext(ctx, toolName), rest)
  }
  return { inject: upstream.inject, Config, apply }
}
