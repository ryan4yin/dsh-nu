import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PACKAGE_NAME } from '../src/index.ts'

test('the package entry loads', () => {
  assert.equal(PACKAGE_NAME, 'dsh-nu')
})
