/** The `bash` tool row: dsh's bash tool, described as the Nushell shell that runs. */

import * as upstream from '@deepseek-ai/dsh-tool-bash'
import { shellTool } from './shell-tool.js'

/** Plugin name used in loader diagnostics. */
export const name = 'nu-tool-bash'

export const { inject, Config, apply } = shellTool(upstream as never, 'bash')
