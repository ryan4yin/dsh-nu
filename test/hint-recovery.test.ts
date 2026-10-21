import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { deprecationHintFor, findSyntaxIssue, hintFor } from '../src/syntax.ts'

const nuAvailable = spawnSync('nu', ['--version'], { encoding: 'utf8', timeout: 5_000 }).status === 0

function fixture(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-recovery-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  return {
    cwd,
    run(command: string) {
      const result = spawnSync('nu', ['--no-config-file', '-c', command], { cwd, encoding: 'utf8', timeout: 5_000 })
      assert.equal(result.error, undefined, command)
      return {
        status: result.status,
        stdout: result.stdout.replace(/\r\n/g, '\n'),
        stderr: result.stderr.replace(/\r\n/g, '\n'),
      }
    },
  }
}

test('new hints lead from real failures to the expected Nushell values', { skip: !nuAvailable }, async (t) => {
  const { run } = fixture(t)
  const samples = [
    {
      broken: '$env.DSH_NU_HINT_SAMPLE = "sample"; $env | select DSH_NU_HINT_SAMPLE | where name == sample',
      id: 'input-type',
      fixed: '$env.DSH_NU_HINT_SAMPLE = "sample"; $env | select DSH_NU_HINT_SAMPLE | transpose key value | where key == "DSH_NU_HINT_SAMPLE" | get value | first',
      output: 'sample',
    },
    {
      broken: `' {"NAME":"sample"} ' | from json | where key == "NAME"`,
      id: 'input-type',
      fixed: `' {"NAME":"sample"} ' | from json | get NAME`,
      output: 'sample',
    },
    {
      broken: `' {"NAME":"sample"} ' | from json | where key == "NAME"`,
      id: 'input-type',
      fixed: `' {"NAME":"sample"} ' | from json | transpose key value | where key == "NAME" | get value | first`,
      output: 'sample',
    },
    { broken: 'echo hello | complete', id: 'complete-internal', fixed: 'echo hello', output: 'hello' },
    {
      broken: 'for x in [1 2] { $x * 2 } | to json',
      id: 'statement-in-pipeline',
      fixed: '[1 2] | each { |x| $x * 2 } | to json | from json | to nuon',
      output: '[2, 4]',
    },
    {
      broken: '[1 2] | let values = $in',
      id: 'assignment-requires-variable',
      fixed: 'let values = ([1 2] | each { |x| $x * 2 }); $values | to nuon',
      output: '[2, 4]',
    },
    { broken: '"A" | decode base64', id: 'invalid-base64', fixed: "'aGk=' | decode base64 | to nuon", output: '0x[6869]' },
    { broken: 'echo hello e>| ignore', id: 'internal-stderr-pipe', fixed: 'echo hello', output: 'hello' },
  ]
  for (const sample of samples) {
    const failed = run(sample.broken)
    assert.equal(failed.status, 1, sample.broken)
    assert.match(hintFor(failed.stderr) ?? '', new RegExp(`^Nushell hint \\(${sample.id}\\):`), failed.stderr)
    const fixed = run(sample.fixed)
    assert.equal(fixed.status, 0, sample.fixed + '\n' + fixed.stderr)
    assert.equal(fixed.stderr, '', sample.fixed)
    assert.equal(fixed.stdout.trim(), sample.output, sample.fixed)
    assert.equal(await findSyntaxIssue(sample.fixed), undefined, sample.fixed)
  }
  // The record failure selects only a value created by this test, never actual environment values.
  for (const [command, output] of [
    ['$env.DSH_NU_HINT_SAMPLE = "sample"; $env.DSH_NU_HINT_SAMPLE?', 'sample'],
    ['print ($env.DSH_NU_HINT_MISSING? == null)', 'true'],
    ['{ a: 1 } | describe', 'record<a: int>'],
    ['let result = (1 | to json); $result', '1'],
    ['let x = 1 | to json; $x', '1'],
    ['{ a: 1 } | to nuon', '{a: 1}'],
    ['[[a]; [1]] | to nuon', '[[a]; [1]]'],
  ]) {
    const result = run(command!)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout.trim(), output)
  }
  assert.equal((await findSyntaxIssue('export FOO=1'))?.id, 'export-assignment')
  assert.equal(await findSyntaxIssue('for x in [1 2] { $x } | to json'), undefined)
  assert.equal(await findSyntaxIssue('[1 2] | let values = $in'), undefined)
})

test('stderr refusals distinguish file redirection, capture and deliberate error handling', { skip: !nuAvailable }, async (t) => {
  const { cwd, run } = fixture(t)
  for (const command of ['echo hi 2> err.txt', 'echo hi 2>| ignore', 'echo hi 2>/dev/null']) {
    const finding = await findSyntaxIssue(command)
    assert.ok(finding, command)
    assert.match(finding.fix, /For an external command/)
    assert.match(finding.fix, /On POSIX/)
    assert.match(finding.fix, /preserves the exit status/)
    assert.match(finding.fix, /deliberately ignores failure/)
    assert.doesNotMatch(finding.fix, /Drop stderr with e>\| ignore/)
  }
  const pipeRefusal = run('echo hi 2>| ignore')
  assert.equal(pipeRefusal.status, 1)
  assert.match(pipeRefusal.stderr, /nu::parser::shell_err/)
  assert.match(hintFor(pipeRefusal.stderr) ?? '', /Nushell hint \(stderr-file\)/)

  const external = '^nu --no-config-file -c \'print out; print --stderr err; exit 7\''
  let result = run(external + ' e> err.txt')
  assert.equal(result.status, 7)
  assert.equal(result.stdout.trim(), 'out')
  assert.equal(result.stderr, '')
  assert.equal(readFileSync(join(cwd, 'err.txt'), 'utf8').trim(), 'err')

  result = run(external + ' e>> err.txt')
  assert.equal(result.status, 7)
  assert.equal(result.stdout.trim(), 'out')
  assert.equal(result.stderr, '')
  assert.equal(readFileSync(join(cwd, 'err.txt'), 'utf8').replace(/\r\n/g, '\n').trim(), 'err\nerr')

  result = run(external + ' o> out.txt')
  assert.equal(result.status, 7)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'err')
  assert.equal(readFileSync(join(cwd, 'out.txt'), 'utf8').trim(), 'out')

  result = run(external + ' o+e> all.txt')
  assert.equal(result.status, 7)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.deepEqual(readFileSync(join(cwd, 'all.txt'), 'utf8').trim().split(/\r?\n/).sort(), ['err', 'out'])

  result = run(`(do { ${external} } | complete) | to json --raw`)
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  const captured = JSON.parse(result.stdout) as { stdout: string; stderr: string; exit_code: number }
  assert.equal(captured.stdout.trim(), 'out')
  assert.equal(captured.stderr.trim(), 'err')
  assert.equal(captured.exit_code, 7)

  for (const [command, output] of [
    ['try { error make { msg: "expected" } } catch { |err| $err.msg }', 'expected'],
    ['do -i { error make { msg: "expected" } }; print after', 'after'],
    ['try { echo hello } catch { |err| $err.msg }', 'hello'],
    ['do -i { echo hello }', 'hello'],
  ]) {
    result = run(command!)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout.trim(), output)
  }
})

test('POSIX stderr discard preserves external status and downstream input', { skip: !nuAvailable || process.platform === 'win32' }, (t) => {
  const { run } = fixture(t)
  const external = '^nu --no-config-file -c \'print out; print --stderr err; exit 7\''
  const discarded = run(external + ' e> /dev/null')
  assert.equal(discarded.status, 7)
  assert.equal(discarded.stdout.trim(), 'out')
  assert.equal(discarded.stderr, '')
  const piped = run('^nu --no-config-file -c \'print out; print --stderr err\' e> /dev/null | str uppercase')
  assert.equal(piped.status, 0)
  assert.equal(piped.stdout.trim(), 'OUT')
  assert.equal(piped.stderr, '')
})

test('deprecation labels ignore command source text that names another warning', { skip: !nuAvailable }, (t) => {
  const { run } = fixture(t)
  const cases = [
    {
      before: 'let note = "filter was deprecated"; { a: 1 } | get -i a',
      after: 'let note = "filter was deprecated"; { a: 1 } | get -o a',
      guidance: /get -o \/ --optional/,
      wrong: /filter is deprecated/,
      output: '1',
    },
    {
      before: 'let note = "get --ignore-errors was deprecated"; "abc" | str upcase',
      after: 'let note = "get --ignore-errors was deprecated"; "abc" | str uppercase',
      guidance: /str uppercase/,
      wrong: /get -o/,
      output: 'ABC',
    },
    {
      before: 'let note = "filter was deprecated; get --ignore-errors was deprecated; str upcase was deprecated"; "ABC" | str downcase',
      after: 'let note = "filter was deprecated; get --ignore-errors was deprecated; str upcase was deprecated"; "ABC" | str lowercase',
      guidance: /warning's help text/,
      wrong: /filter is deprecated|get -o|str uppercase/,
      output: 'abc',
    },
  ]
  for (const sample of cases) {
    const before = run(sample.before)
    assert.equal(before.status, 0)
    assert.match(before.stderr, /Warning: nu::parser::deprecated/)
    const hint = deprecationHintFor(before.stderr) ?? ''
    assert.match(hint, sample.guidance)
    assert.doesNotMatch(hint, sample.wrong)
    assert.equal(hintFor(before.stderr), hint)
    const after = run(sample.after)
    assert.equal(after.status, 0)
    assert.equal(after.stderr, '')
    assert.equal(after.stdout.trim(), sample.output)
    assert.equal(after.stdout, before.stdout)
  }
})

test('base64 hints cover actual invalid symbols and padding lengths', { skip: !nuAvailable }, (t) => {
  const { run } = fixture(t)
  for (const [command, diagnostic] of [
    ['"@@@@" | decode base64', /invalid symbol at 0/],
    ['"A===" | decode base64', /invalid padding length at 1/],
  ] as const) {
    const failed = run(command)
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /nu::shell::incorrect_value/)
    assert.match(failed.stderr, diagnostic)
    assert.match(hintFor(failed.stderr) ?? '', /^Nushell hint \(invalid-base64\)/)
    const fixed = run("'aGk=' | decode base64 | to nuon")
    assert.equal(fixed.status, 0)
    assert.equal(fixed.stderr, '')
    assert.equal(fixed.stdout.trim(), '0x[6869]')
  }
})

test('deprecation warnings give specific verified replacements and a safe fallback', { skip: !nuAvailable }, (t) => {
  const { run } = fixture(t)
  const cases = [
    { before: '[1 2] | filter { |x| $x > 1 } | to nuon', after: '[1 2] | where { |x| $x > 1 } | to nuon', output: '[2]', guidance: /where with the same predicate closure/ },
    { before: '{ a: 1 } | get -i missing | to nuon', after: '{ a: 1 } | get -o missing | to nuon', output: 'null', guidance: /get -o \/ --optional/ },
    { before: '"abc" | str upcase', after: '"abc" | str uppercase', output: 'ABC', guidance: /str uppercase/ },
  ]
  for (const sample of cases) {
    const before = run(sample.before)
    assert.equal(before.status, 0)
    assert.match(before.stderr, /Warning: nu::parser::deprecated/)
    assert.match(deprecationHintFor(before.stderr) ?? '', sample.guidance)
    assert.equal(hintFor(before.stderr), deprecationHintFor(before.stderr))
    const after = run(sample.after)
    assert.equal(after.status, 0)
    assert.equal(after.stderr, '')
    assert.equal(after.stdout.trim(), sample.output)
    assert.equal(after.stdout, before.stdout)
  }
  const optionalLong = run('{ a: 1 } | get --optional missing | to nuon')
  assert.equal(optionalLong.status, 0)
  assert.equal(optionalLong.stdout.trim(), 'null')
  assert.equal(optionalLong.stderr, '')
  const unknown = run('"ABC" | str downcase')
  assert.equal(unknown.status, 0)
  assert.equal(unknown.stdout.trim(), 'abc')
  assert.match(deprecationHintFor(unknown.stderr) ?? '', /warning's help text/)
  assert.doesNotMatch(deprecationHintFor(unknown.stderr) ?? '', /PowerShell|str uppercase|get -o/)
  const help = run('help str downcase | str contains "lowercase"')
  assert.equal(help.status, 0)
  assert.equal(help.stdout.trim(), 'true')
  assert.equal(help.stderr, '')
  const replacement = run('"ABC" | str lowercase')
  assert.equal(replacement.status, 0)
  assert.equal(replacement.stdout.trim(), 'abc')
  assert.equal(replacement.stderr, '')
})

test('error hints outrank warnings and generic errors stay unmatched', { skip: !nuAvailable }, (t) => {
  const { run } = fixture(t)
  const mixed = run('ls | select -First 2')
  assert.equal(mixed.status, 1)
  assert.match(mixed.stderr, /Warning: nu::parser::deprecated/)
  assert.match(mixed.stderr, /Error: nu::parser::unknown_flag/)
  assert.match(hintFor(mixed.stderr) ?? '', /^Nushell hint \(unknown-flag\)/)
  const help = run('help select | str contains "--optional"')
  assert.equal(help.status, 0)
  assert.equal(help.stdout.trim(), 'true')
  assert.equal(help.stderr, '')
  const external = run('def nu [] { "internal" }; ^nu --version')
  assert.equal(external.status, 0)
  assert.match(external.stdout.trim(), /^\d+\.\d+\.\d+/)
  assert.equal(external.stderr, '')

  const unknownError = run('[1] | filter { true }; error make { msg: "unrelated failure" }')
  assert.equal(unknownError.status, 1)
  assert.match(unknownError.stderr, /Warning: nu::parser::deprecated/)
  assert.match(unknownError.stderr, /Error: nu::shell::error/)
  assert.equal(hintFor(unknownError.stderr), undefined)
  const unrelated = run('error make { msg: "unrelated failure" }')
  assert.equal(unrelated.status, 1)
  assert.match(unrelated.stderr, /nu::shell::error/)
  assert.equal(hintFor(unrelated.stderr), undefined)
  assert.equal(deprecationHintFor(unrelated.stderr), undefined)
  assert.equal(deprecationHintFor(''), undefined)
  assert.equal(deprecationHintFor('some unrelated warning'), undefined)
  assert.equal(deprecationHintFor('example text: nu::parser::deprecated'), undefined)
})
