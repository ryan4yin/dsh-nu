import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyze, clearAnalysisCache, isQuoted, literalValue, PreflightError } from '../src/ast.ts'

test('the token stream names command heads, arguments, and nested blocks', async () => {
  const analysis = await analyze('print $"(bash -c \\"echo hi\\")"')
  const external = analysis.tokens.find((token) => token.shape === 'shape_external')
  assert.equal(external?.content, 'bash')
  assert.equal(analysis.command.slice(external.start, external.end), 'bash')
  assert.ok(analysis.tokens.some((token) => token.shape === 'shape_internalcall' && token.content === 'print'))
})

test('quoted strings keep their quotes in token content, bare words do not', async () => {
  const quoted = await analyze("print '>'")
  assert.equal(quoted.tokens.find((token) => token.shape === 'shape_string')?.content, "'>'")
  const bare = await analyze('print hi > out.txt')
  assert.deepEqual(
    bare.tokens.filter((token) => token.shape === 'shape_string').map((token) => token.content),
    ['hi', '>', 'out.txt'],
  )
  const operator = await analyze('let b = 1 > 2')
  assert.ok(operator.tokens.some((token) => token.shape === 'shape_operator' && token.content === '>'))
})

test('non-ASCII text does not shift the byte-based parser offsets', async () => {
  const command = 'print "héllo" > out.txt'
  const analysis = await analyze(command)
  const target = analysis.tokens.find((token) => token.content === 'out.txt')
  assert.deepEqual(target && command.slice(target.start, target.end), 'out.txt')
  const diagnostic = await analyze('écho hi 2>&1')
  const span = diagnostic.diagnostics[0]!
  assert.equal(diagnostic.command.slice(span.start, span.end), '2>&1')
})

test('the diagnostics stream carries real parser errors', async () => {
  const analysis = await analyze('ls -R')
  assert.ok(analysis.diagnostics.some((item) => item.severity === 'Error' && item.message.includes("doesn't have flag `-R`")))
  const clean = await analyze('ls -a')
  assert.equal(clean.diagnostics.length, 0)
})

test('repeated analyses share one cache entry', async () => {
  clearAnalysisCache()
  const first = analyze('echo hi')
  const second = analyze('echo hi')
  assert.equal(first, second)
  await first
  clearAnalysisCache()
})

test('a missing Nushell binary is a PreflightError, not a crash', async () => {
  await assert.rejects(analyze('echo hi', { binary: 'dsh-nu-definitely-not-a-real-nu' }), PreflightError)
})

test('quoted literals are decoded, bare words are returned as written', () => {
  assert.equal(isQuoted("'a'"), true)
  assert.equal(isQuoted('a'), false)
  assert.equal(literalValue("'a b'"), 'a b')
  assert.equal(literalValue('"a\\nb"'), 'a\nb')
  assert.equal(literalValue('plain'), 'plain')
  assert.equal(literalValue("r#'a b'#"), 'a b')
  assert.equal(literalValue(`r##'a "b"'##`), `a "b"`)
})
