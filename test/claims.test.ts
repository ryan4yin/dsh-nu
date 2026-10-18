import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

/**
 * Claims the teaching layer makes about Nushell, executed against the real
 * binary. These are the statements a model learns to rely on; a docs-only test
 * cannot catch a wrong claim.
 */
const nu = spawnSync('nu', ['--version'], { encoding: 'utf8' })
const nuAvailable = nu.status === 0

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function run(command: string, cwd: string): Run {
  const result = spawnSync('nu', ['--no-config-file', '-c', command], { cwd, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function ok(result: Run, command: string): string {
  assert.equal(result.status, 0, command + ' failed: ' + result.stderr.slice(0, 300))
  return result.stdout.trim()
}

test('every teaching claim holds in the real Nushell', { skip: !nuAvailable }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-nu-claims-'))
  try {
    // Quotes are literal; only $"..." interpolates.
    assert.equal(ok(run('let name = "world"; print "hi $name"', cwd), 'double-quoted literal'), 'hi $name')
    assert.equal(ok(run('let name = "world"; print $"hi ($name)"', cwd), 'interpolation'), 'hi world')
    assert.equal(ok(run("print r#'hi $name'#", cwd), 'raw string'), 'hi $name')

    // to json is a boundary conversion that returns text, not a table.
    assert.equal(ok(run('[[a]; [1]] | to json | describe', cwd), 'to json type'), 'string')

    // and / or are boolean operators, not command separators.
    assert.equal(ok(run('true and true', cwd), 'and'), 'true')

    // save -a appends and o>> appends; both are documented.
    assert.equal(ok(run('"a" | save -f f.txt; "b" | save -a f.txt; open --raw f.txt | str contains "b"', cwd), 'save append'), 'true')
    // print writes straight to stdout and ignores redirection, so the append
    // claim is checked with an external command that produces a stream.
    assert.equal(ok(run('^nu --no-config-file -c "print x" o>> g.txt; ^nu --no-config-file -c "print y" o>> g.txt; open --raw g.txt | lines | length', cwd), 'o>> append'), '2')

    // print writes to stdout but returns nothing, so a pipeline after it has no input.
    const printed = run('print "x" | str length', cwd)
    assert.notEqual(printed.status, 0, 'print pipeline should fail')
    assert.match(printed.stderr, /input_type_mismatch/)

    // mkdir creates parents; path exists reports it.
    assert.equal(ok(run('mkdir a/b/c; "a/b/c" | path exists', cwd), 'mkdir parents'), 'true')

    // An optional environment read yields null instead of failing.
    assert.equal(ok(run('print ($env.DSH_NU_UNSET_XYZ? == null)', cwd), 'optional env'), 'true')

    // A failing external aborts the rest of the command.
    assert.equal(ok(run('do -i { ^nu -c "exit 1" }; print "after"', cwd), 'do -i'), 'after')
    assert.notEqual(run('^nu -c "exit 1"; print "after"', cwd).stdout.trim(), 'after')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
