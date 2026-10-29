/** The `pwsh` tool row: dsh's pwsh tool, described as the Nushell shell that runs. */

import * as upstream from '@deepseek-ai/dsh-tool-pwsh'
import { shellTool } from './shell-tool.js'

/** Plugin name used in loader diagnostics. */
export const name = 'nu-tool-pwsh'

export const { inject, Config, apply } = shellTool(upstream as never, 'pwsh')
