import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NUSHELL_COMMAND_DESCRIPTION } from '../src/guide.ts'
import { apply, normalizeConfig, NuNativeToolExecutor } from '../src/native-executor.ts'

function definition(name: string, description: string) {
  const parameters = { type: 'object', properties: { command: { type: 'string', description: 'The bash command to execute.' } } }
  return { name, description, parameters } as never
}

const TOOLS = [definition('bash', 'Execute a bash command (`bash -c`).'), definition('read', 'Read a file.')]

function mount(config: unknown): NuNativeToolExecutor {
  let executor: unknown
  apply({ tools: { setExecutor: (selected: unknown) => (executor = selected) } } as never, config as never)
  assert.ok(executor instanceof NuNativeToolExecutor)
  return executor
}

test('the executor rewrites the shell tool schema and leaves other tools alone', () => {
  const [bash, read] = mount({}).describe(TOOLS).schemas as any[]
  assert.match(bash.description, /^Execute a Nushell command \(`nu --no-config-file -c`\)/)
  assert.equal(bash.parameters.properties.command.description, NUSHELL_COMMAND_DESCRIPTION)
  assert.equal(read.description, 'Read a file.')
})

test('rewriteToolDescriptions false keeps the host schemas', () => {
  const [bash] = mount({ rewriteToolDescriptions: false }).describe(TOOLS).schemas as any[]
  assert.equal(bash.description, 'Execute a bash command (`bash -c`).')
})

test('toolNames selects the rewritten schemas', () => {
  const [bash] = mount({ toolNames: ['pwsh'] }).describe(TOOLS).schemas as any[]
  assert.equal(bash.description, 'Execute a bash command (`bash -c`).')
})

test('totality: executor settings are validated at boot', () => {
  assert.deepEqual(normalizeConfig({}), { rewriteToolDescriptions: true, toolNames: ['bash', 'pwsh'] })
  assert.throws(() => normalizeConfig({ rewriteToolDescriptions: 'yes' }), /rewriteToolDescriptions/)
  assert.throws(() => normalizeConfig({ toolNames: [1] }), /toolNames/)
})
