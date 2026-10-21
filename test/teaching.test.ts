import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildGuide, buildRules, buildToolDescription, NUSHELL_COMMAND_DESCRIPTION } from '../src/guide.ts'
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

test('the guide does not claim double-quoted strings interpolate', () => {
  const text = buildGuide({ variant: 'full' })
  assert.match(text, /Interpolation is `\$"text \(expr\)"` or `\$'text \(expr\)'`/)
  assert.doesNotMatch(text, /double quotes interpolate/i)
  assert.match(text, /to json.*returns text|return text, not a table/)
})

test('the guides serialize final output', () => {
  for (const variant of ['full', 'compact'] as const) {
    const text = buildGuide({ variant })
    assert.match(text, /to text[\s\S]*(?:to json|for lines)/i)
  }
  const full = buildGuide({ variant: 'full' })
  assert.doesNotMatch(full, /Single and double quotes are literal/)
  assert.match(full, /Single quotes are literal; double quotes process escapes/)
})

test('each teaching fact has one home across rules, guide, and fallback description', () => {
  // The rules section states the policy; the guide owns syntax. A repeated
  // sentence across them costs prompt tokens on every request.
  const sentences = (text: string): string[] => text.split(/(?<=[.;:])\s+|\n+/).map((part) => part.trim()).filter((part) => part.length > 40)
  const rules = new Set(sentences(buildRules()))
  for (const variant of ['full', 'compact'] as const) {
    for (const sentence of sentences(buildGuide({ variant }))) assert.ok(!rules.has(sentence), variant + ' repeats the rules: ' + sentence)
  }
  assert.doesNotMatch(buildRules() + buildGuide({ variant: 'full' }), /fails closed/)
})

test('guide off drops the guide and rules false drops the rules', () => {
  const off = fakeContext()
  apply(off.ctx as never, { guide: 'off' })
  assert.deepEqual(off.sections.map((section) => section.name), [RULES_SECTION])
  const bare = fakeContext()
  apply(bare.ctx as never, { rules: false, guide: 'compact' })
  assert.deepEqual(bare.sections.map((section) => section.name), [GUIDE_SECTION])
  assert.match((bare.sections[0]!.text as () => string)(), /e>\| ignore/)
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

// Host descriptions as dsh 0.2.1-rc.2 renders them (bash; pwsh without the Windows sandbox).
const HOST_BASH = 'Execute a bash command (`bash -c`) and return its stdout/stderr. Each call runs in a fresh shell; pass `workdir` instead of using `cd`. Managed `$DSH_*` variables expose current harness environment facts. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. Provide `description` before `command` in the arguments. Before any delete or move, verify that the resolved absolute target path is the intended one; never run it against a computed path you have not checked. An unset variable expands to an empty string, so guard variables in such paths with `${VAR:?}`. Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.'
const HOST_PWSH = 'Execute a PowerShell command (`pwsh -Command`) and return its stdout/stderr. Each call runs in a fresh pwsh process; pass `workdir` instead of using `cd`. Paths use native Windows form (`C:\\...`); read environment variables with `$env:NAME`. Managed `$env:DSH_*` variables expose current harness environment facts. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. On Windows a force-killed command settles as `[exit code: 1]` without a signal marker — treat it as an interruption, not a command failure. Provide `description` before `command` in the arguments. Before any delete or move, verify that the resolved absolute target path is the intended one; never run it against a computed path you have not checked. Do not assign to automatic variables such as `$HOME`; variable names are case-insensitive, so `$home` is the same read-only variable. Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.'

test('the host tool descriptions keep their contract and lose only shell claims', async () => {
  const { ctx, listeners } = fakeContext()
  apply(ctx as never, {})
  const listener = listeners.get('system-prompt/assemble')![0]!
  for (const [name, description] of [['bash', HOST_BASH], ['pwsh', HOST_PWSH]] as const) {
    const tool = { ...bashTool(description), name }
    const result = await listener({ tools: [tool] }, {}, async () => ({ tools: [tool] }))
    const text = result.tools[0].description as string
    assert.match(text, /^Execute a Nushell command \(`nu --no-config-file -c`\)/, name)
    assert.doesNotMatch(text, /\bbash\b|\bpwsh\b|PowerShell|\$\{VAR:\?\}|\$env:|`\$DSH_|fresh shell/i, name)
    assert.match(text, /`\$env\.DSH_\*`/, name)
    assert.match(text, /\[sandbox: file access denied under <mode> mode\]/, name)
    assert.match(text, /Provide `description` before `command`/, name)
    assert.notEqual(text, buildToolDescription(), name)
  }
})

test('an unrecognized host wording falls back to the bundle description', async () => {
  const { ctx, listeners } = fakeContext()
  apply(ctx as never, {})
  const listener = listeners.get('system-prompt/assemble')![0]!
  const tool = bashTool('Runs your command in GNU bash 5.')
  const result = await listener({ tools: [tool] }, {}, async () => ({ tools: [tool] }))
  assert.equal(result.tools[0].description, buildToolDescription())
  assert.match(buildToolDescription(), /^Execute a Nushell command/)
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

test('the SDK rewrite does not double a sentence period', () => {
  const text = rewriteSdkText('The bash command to execute. Runs bash -c.')
  assert.doesNotMatch(text, /\.\./)
})

test('the SDK rewrite removes host-shell claims from the generated text', () => {
  const text = [
    'An unset variable expands to an empty string, so guard variables in such paths with `${VAR:?}`.',
    'Each call runs in a fresh pwsh process; read environment variables with `$env:NAME`. Managed `$env:DSH_*` variables are set.',
    'Do not assign to automatic variables such as `$HOME`; variable names are case-insensitive, so `$home` is the same read-only variable.',
    'Under the Windows sandbox, read-only pwsh runs in PowerShell ConstrainedLanguage mode, while workspace-write stays in FullLanguage unless host policy says otherwise. In read-only, prefer cmdlets and core types (`[string]`); .NET static calls fail with "only core types" errors. `-f` formatting, property access, and core cmdlets work. In both confined modes, programs cannot open named pipes.',
    "PowerShell's own pipelines are unaffected.",
  ].join(' ')
  const rewritten = rewriteSdkText(text)
  assert.doesNotMatch(rewritten, /\$\{VAR:\?\}|\$env:|case-insensitive|ConstrainedLanguage|pwsh process|PowerShell/)
  assert.match(rewritten, /\$env\.NAME/)
  assert.match(rewritten, /\$env\.DSH_\*/)
  assert.match(rewritten, /fresh Nushell process/)
  assert.match(rewritten, /Variable names are case-sensitive\./)
  assert.match(rewritten, /Nushell's own pipelines/)
  assert.equal(rewriteSdkText(rewritten), rewritten)
})

test('the SDK rewrite is idempotent', () => {
  const once = rewriteSdkText('Execute a bash command with bash -c')
  const twice = rewriteSdkText(once)
  assert.equal(twice, once)
  assert.match(once, /Execute a Nushell command with nu --no-config-file -c/)
})
