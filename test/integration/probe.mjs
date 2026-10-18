/**
 * In-composition self-test. Mounted by test/integration.mjs into a scratch
 * profile; obverses the live shell seam, prompt sections, and tool schemas,
 * then exits non-zero when a promise is broken.
 */
import { NushellExecutor } from 'dsh-nu/executor'

export const inject = ['shell', 'systemPrompt']

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === '' ? '' : ' :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 200)))
}

async function run(shell, command) {
  const handle = await shell.execute(shell.resolve({ command }))
  return handle.result()
}

export async function apply(ctx) {
  const shell = ctx.shell
  record('the shell service is this package\'s executor', shell instanceof NushellExecutor, shell?.constructor?.name)

  const builtin = await run(shell, 'version | get version')
  record('a Nushell builtin pipeline runs', builtin.exitCode === 0 && /^\d+\.\d+/.test(builtin.stdout.text.trim()), builtin.stdout.text)

  const table = await run(shell, 'ls | where type == file | length')
  record('a Nushell table pipeline runs', table.exitCode === 0 && /^\d+$/.test(table.stdout.text.trim()), table.stdout.text)

  let refused = ''
  try {
    await run(shell, 'bash -c "echo hi"')
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error)
  }
  record('a foreign-shell handoff is refused', /refusing to hand this command to bash|Nushell only/.test(refused), refused)

  let dialect = ''
  try {
    await run(shell, 'print hi 2>&1')
  } catch (error) {
    dialect = error instanceof Error ? error.message : String(error)
  }
  record('a bash redirection is refused before spawning', /refusing a stderr-redirect/.test(dialect), dialect)

  const marker = await run(shell, 'mut probeMarker = 1')
  const leaked = await run(shell, 'print $probeMarker')
  record('each call is a fresh process', marker.exitCode === 0 && leaked.exitCode !== 0, 'exit ' + leaked.exitCode)

  const expectedWorkdir = process.env.DSH_NU_PROBE_WORKDIR
  if (expectedWorkdir === undefined) {
    record('the call runs in its workdir', false, 'DSH_NU_PROBE_WORKDIR is unset')
  } else {
    const handle = await shell.execute(shell.resolve({ command: 'pwd | str trim', workdir: expectedWorkdir }))
    const pwd = await handle.result()
    record('the call runs in its workdir', pwd.exitCode === 0 && pwd.stdout.text.trim() === expectedWorkdir, pwd.stdout.text)
  }

  const background = await shell.execute(shell.resolve({ command: 'sleep 60sec', onExpiry: 'none' }))
  record('a background call returns a live process', background.status === 'running', background.status)
  record('a background call can be killed', background.kill() === true)
  await background.done
  record('a killed background call settles as killed', background.status === 'killed', background.status)

  const failed = await run(shell, 'ls /definitely-missing-dsh-nu-probe')
  record('a failed command carries one Nushell hint', /Nushell hint \(path-not-found\)/.test(failed.stderr.text), failed.stderr.text)

  const assembly = await ctx.systemPrompt.assemble()
  const prompt = assembly.sections.map((section) => (typeof section.text === 'string' ? section.text : '')).join('\n\n')
  record('the prompt carries the shell rules', prompt.includes('Shell: Nushell only'))
  record('the prompt carries the syntax guide', prompt.includes('Nushell syntax guide'))
  const tool = assembly.tools?.find((entry) => entry.name === 'bash' || entry.name === 'pwsh')
  if (tool !== undefined) record('the shell tool description is Nushell', /dialect is Nushell/.test(tool.description), tool.name)

  const sdk = assembly.sections.find((section) => section.name === 'tools:sdk')
  if (process.env.DSH_NU_PROBE_PTC === '1') {

    record('the PTC SDK section is generated', sdk !== undefined)
    if (sdk !== undefined) {
      record('the PTC SDK declarations describe Nushell', /Execute a Nushell command/.test(sdk.text))
      record('the PTC SDK declarations never claim bash', !/Execute a bash command/.test(sdk.text) && !/The bash command/.test(sdk.text) && !/bash -c/.test(sdk.text))
      record('the PTC SDK sentence keeps one period', !/PowerShell\)\.\./.test(sdk.text))
    }
  }

  const failures = results.filter((entry) => !entry.ok)
  if (failures.length === 0) console.log('PROBE OK')
  process.exit(failures.length === 0 ? 0 : 1)
}
