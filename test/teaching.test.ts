import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NUSHELL_COMMAND_DESCRIPTION } from '../src/guide.ts'
import {
  apply,
  GUIDE_SECTION,
  normalizeConfig,
  rewriteSdkText,
  RULES_SECTION,
  SDK_SECTION,
} from '../src/teaching.ts'

interface Section {
  name: string
  order: number
  text: string | (() => string)
}

function fakeContext(): {
  ctx: unknown
  sections: Section[]
  listeners: Map<string, Array<(assembly: any, context: unknown, next: () => Promise<any>) => Promise<any>>>
} {
  const sections: Section[] = []
  const listeners = new Map<string, Array<(assembly: any, context: unknown, next: () => Promise<any>) => Promise<any>>>()
  const ctx = {
    systemPrompt: {
      section(section: Section): void {
        sections.push(section)
      },
      getSectionOrder(): number {
        return 500
      },
    },
    on(event: string, listener: (assembly: any, context: unknown, next: () => Promise<any>) => Promise<any>): void {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    logger: { info(): void {} },
  }
  return { ctx, sections, listeners }
}

function bashTool(description = 'Execute a bash command.') {
  return {
    name: 'bash',
    description,
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'The bash command to execute.' } } },
  }
}

test('registers the rules and guide sections after the shell tool', () => {
  const { ctx, sections } = fakeContext()
  apply(ctx as never, {})
  assert.deepEqual(sections.map((section) => section.name), [RULES_SECTION, GUIDE_SECTION])
  assert.equal(sections[0]!.order, 500)
  assert.match(sections[0]!.text as string, /Shell: Nushell only/)
  const guide = sections[1]!.text as () => string
  assert.match(guide(), /Nushell syntax guide/)
})

test('guide off drops the guide and rules false drops the rules', () => {
  const off = fakeContext()
  apply(off.ctx as never, { guide: 'off' })
  assert.deepEqual(off.sections.map((section) => section.name), [RULES_SECTION])
  const bare = fakeContext()
  apply(bare.ctx as never, { rules: false, guide: 'compact' })
  assert.deepEqual(bare.sections.map((section) => section.name), [GUIDE_SECTION])
  assert.match((bare.sections[0]!.text as () => string)(), /one fresh process per call/)
})

test('the assemble listener rewrites shell tool descriptions and their command parameter', async () => {
  const { ctx, listeners } = fakeContext()
  apply(ctx as never, {})
  const listener = listeners.get('system-prompt/assemble')?.[0]
  assert.notEqual(listener, undefined)
  const assembly = {
    tools: [bashTool(), { name: 'read', description: 'Read a file.' }],
    sections: [{ name: SDK_SECTION, text: 'Execute a bash command. Runs bash -c. The bash command to execute.' }],
  }
  const result = await listener!(assembly, {}, async () => assembly)
  const tools = result.tools as any[]
  assert.match(tools[0].description, /Execute a Nushell command/)
  assert.equal(tools[0].parameters.properties.command.description, NUSHELL_COMMAND_DESCRIPTION)
  assert.equal(tools[1].description, 'Read a file.')
  assert.equal(result.sections[0].text.includes('bash -c'), false)
  assert.match(result.sections[0].text, /nu --no-config-file -c/)
  assert.match(result.sections[0].text, /Execute a Nushell command/)
})

test('a tool whose description does not claim bash is left alone', async () => {
  const { ctx, listeners } = fakeContext()
  apply(ctx as never, {})
  const listener = listeners.get('system-prompt/assemble')![0]!
  const custom = { name: 'bash', description: 'Run a private sandbox.', parameters: { properties: { command: { description: 'x' } } } }
  const result = await listener({ tools: [custom] }, {}, async () => ({ tools: [custom] }))
  assert.equal(result.tools[0], custom)
})

test('totality: settings are validated at boot', () => {
  assert.deepEqual(normalizeConfig({}), { guide: 'full', rules: true, rewriteToolDescriptions: true, toolNames: ['bash', 'pwsh'] })
  assert.throws(() => normalizeConfig({ guide: 'short' }), /guide/)
  assert.throws(() => normalizeConfig({ rules: 'yes' }), /rules/)
  assert.throws(() => normalizeConfig({ toolNames: [1] }), /toolNames/)
})

test('the SDK rewrite is idempotent', () => {
  const once = rewriteSdkText('Execute a bash command with bash -c')
  const twice = rewriteSdkText(once)
  assert.equal(twice, once)
  assert.match(once, /Execute a Nushell command with nu --no-config-file -c/)
})
