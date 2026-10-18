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

    // Lists, records, and their accessors.
    assert.equal(ok(run('print ([1 2 3] | length)', cwd), 'list length'), '3')
    assert.equal(ok(run('print ({ a: 1 } | get a)', cwd), 'record get'), '1')

    // Single quotes stay literal too; raw strings keep everything literal.
    assert.equal(ok(run("print 'hi $name'", cwd), 'single-quoted literal'), 'hi $name')

    // Typed comparisons and table operations.
    assert.equal(ok(run('[[size]; [2mb]] | where size > 1mb | length', cwd), 'typed where'), '1')
    assert.equal(ok(run('[[a]; [2] [1]] | sort-by a | get a | first', cwd), 'sort-by'), '1')
    assert.equal(ok(run('"a,b" | split row "," | length', cwd), 'split row'), '2')
    assert.equal(ok(run('"a1" | str replace -r \'\\d\' "#"', cwd), 'str replace'), 'a#')

    // Control flow.
    assert.equal(ok(run('if 2 > 1 { print "yes" } else { print "no" }', cwd), 'if'), 'yes')
    assert.equal(ok(run('for x in [1 2] { print $x }', cwd), 'for'), '1\n2')
    assert.equal(ok(run('print (match 2 { 1 => "one", _ => "other" })', cwd), 'match'), 'other')
    assert.equal(ok(run('try { error make { msg: "boom" } } catch { |err| print ($err.msg == "boom") }', cwd), 'try catch'), 'true')

    // echo is a pipeline value, not a print side effect; a non-final echo is dropped.
    assert.equal(ok(run('if true { echo "dropped"; print "end" }', cwd), 'echo is not print'), 'end')

    // Optional field access turns a missing field into null.
    assert.equal(ok(run('print ({ a: 1 }.missing? == null)', cwd), 'optional record field'), 'true')

    // for cannot be piped; each maps a list.
    const forPipe = run('for x in [1 2] { $x * 2 } | describe', cwd)
    assert.notEqual(forPipe.status, 0, 'for pipeline should fail')
    assert.match(forPipe.stderr, /unexpected_keyword/)
    assert.equal(ok(run('print ([1 2] | each {|x| $x * 2 } | to nuon)', cwd), 'each list'), '[2, 4]')

    // ignore discards a stream without a file, and the command continues.
    assert.equal(ok(run('^nu --no-config-file -c "print out; print -e err" o+e>| ignore; print "after"', cwd), 'discard streams'), 'after')

    // Environment mutation lasts for this process only.
    assert.equal(ok(run('$env.PROBE_ENV = "x"; print $env.PROBE_ENV', cwd), 'env set'), 'x')

    // External-command redirection captures stdout.
    assert.equal(ok(run('^nu --no-config-file -c "print x" o+e> all.txt; open --raw all.txt | str contains "x"', cwd), 'o+e redirect'), 'true')

    // reduce folds a list.
    assert.equal(ok(run('[1 2 3] | reduce { |it, acc| $it + $acc }', cwd), 'reduce'), '6')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
