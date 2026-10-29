import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NUSHELL_COMMAND_DESCRIPTION } from '../src/guide.ts'
import { shellTool } from '../src/shell-tool.ts'
import * as bash from '../src/tool-bash.ts'
import * as pwsh from '../src/tool-pwsh.ts'

/** A context with just the seams the upstream shell tools touch at apply time. */
function fakeContext() {
  const registered: any[] = []
  const ctx = {
    shell: { sandboxMode: undefined },
    get: () => undefined,
    inject: () => {},
    fiber: { state: 0 },
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 1000 },
    tools: {
      register(definition: unknown) {
        registered.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, registered }
}

for (const [plugin, toolName] of [[bash, 'bash'], [pwsh, 'pwsh']] as const) {
  test(toolName + ' registers the upstream tool with Nushell text', () => {
    const { ctx, registered } = fakeContext()
    plugin.apply(ctx as never, { enableRunInBackground: false })
    assert.equal(registered.length, 1)
    const [tool] = registered
    assert.equal(tool.name, toolName)
    assert.match(tool.description, /^Execute a Nushell command \(`nu --no-config-file -c`\)/)
    assert.doesNotMatch(tool.description, /\bbash\b|\bpwsh\b|PowerShell/i)
    assert.match(tool.description, /\[sandbox: file access denied under <mode> mode\]/)
    assert.equal(tool.parameters.properties.command.description, NUSHELL_COMMAND_DESCRIPTION)
    assert.equal(typeof tool.execute, 'function')
  })

  test(toolName + ' keeps the host text when the rewrite is off', () => {
    const { ctx, registered } = fakeContext()
    plugin.apply(ctx as never, { enableRunInBackground: false, rewriteToolDescriptions: false })
    assert.match(registered[0].description, toolName === 'bash' ? /^Execute a bash command/ : /^Execute a PowerShell command/)
  })
}

test('the wrapper passes the upstream config through and rewrites later registrations', () => {
  const seen: unknown[] = []
  let later: (() => void) | undefined
  const upstream = {
    inject: ['tools'],
    Config: bash.Config,
    apply(ctx: any, config?: object) {
      seen.push(config)
      later = () => ctx.tools.register({ name: 'bash', description: 'Execute a bash command.' })
    },
  }
  const { ctx, registered } = fakeContext()
  shellTool(upstream as never, 'bash').apply(ctx as never, { enableRunInBackground: true, rewriteToolDescriptions: true })
  assert.deepEqual(seen, [{ enableRunInBackground: true }])
  later!()
  assert.match(registered[0].description, /^Execute a Nushell command/)
})

test('the wrapper validates its own setting', () => {
  const { ctx } = fakeContext()
  assert.throws(() => bash.apply(ctx as never, { rewriteToolDescriptions: 'yes' } as never), /rewriteToolDescriptions/)
})
