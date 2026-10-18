import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chooseBinary,
  commandArgv,
  DEFAULT_NU_ARGS,
  normalizePrefix,
  parseVersion,
  TESTED_NUSHELL,
} from '../src/nu.ts'

test('chooseBinary prefers config, then DSH_NU_PATH, then PATH', () => {
  assert.deepEqual(chooseBinary('/opt/nu/bin/nu', { DSH_NU_PATH: '/env/nu' }), { binary: '/opt/nu/bin/nu', origin: 'config' })
  assert.deepEqual(chooseBinary('  ', { DSH_NU_PATH: '/env/nu' }), { binary: '/env/nu', origin: 'environment' })
  assert.deepEqual(chooseBinary(undefined, {}), { binary: 'nu', origin: 'path' })
})

test('normalizePrefix defaults to a fresh default argv and rejects bad input', () => {
  const prefix = normalizePrefix(undefined)
  assert.deepEqual(prefix, [...DEFAULT_NU_ARGS])
  assert.notEqual(prefix, DEFAULT_NU_ARGS)
  assert.deepEqual(normalizePrefix(['--no-config-file', '-c']), ['--no-config-file', '-c'])
  for (const bad of ['--no-config-file', [], ['-c', 1], 42]) {
    assert.throws(() => normalizePrefix(bad), /nuArgs/)
  }
})

test('commandArgv appends the command after the prefix', () => {
  assert.deepEqual(commandArgv('ls', { binary: 'nu', origin: 'path' }), ['nu', '--no-config-file', '-c', 'ls'])
  assert.deepEqual(
    commandArgv('ls', { binary: '/opt/nu', origin: 'config' }, ['-c']),
    ['/opt/nu', '-c', 'ls'],
  )
})

test('parseVersion accepts banner variants and rejects junk', () => {
  assert.equal(parseVersion('0.115.1'), '0.115.1')
  assert.equal(parseVersion('nu 0.115.1'), '0.115.1')
  assert.equal(parseVersion('Nushell 0.115.1 (abc)'), '0.115.1')
  assert.equal(parseVersion(''), undefined)
  assert.equal(parseVersion(undefined), undefined)
  assert.equal(parseVersion('no version here'), undefined)
})

test('the tested Nushell pin matches the manifest', () => {
  assert.equal(TESTED_NUSHELL, '0.115.1')
})
