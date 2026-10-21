import { isDeepStrictEqual, stripVTControlCharacters } from 'node:util'

interface Expectation {
  firstCommand?: string
  recoveryMatches?: string
  outputJson?: unknown
}

interface Call {
  callId: string
  input?: { command?: unknown }
}

interface Result {
  callId: string
  status: string
  result: string
}

/** Grade observed shell results separately from the model's final answer. */
export function shellEvidence(expect: Expectation, calls: readonly Call[], results: readonly Result[]) {
  const resultFor = (index: number) => calls[index] === undefined ? undefined : results.find((event) => event.callId === calls[index]!.callId)
  const textOf = (result: Result | undefined) => stripVTControlCharacters(result?.result ?? '').trim()
  const clean = (result: Result | undefined) => result?.status === 'completed'
    && !/(?:Error|Warning): nu::|dsh-nu: refusing|\[exit code: [1-9]/.test(textOf(result))
  const first = resultFor(0)
  const repair = resultFor(1)
  const firstCommandMatched = expect.firstCommand === undefined || (
    String(calls[0]?.input?.command ?? '').trim() === expect.firstCommand
    && /(?:Error|Warning): nu::|dsh-nu: refusing/.test(textOf(first))
  )
  const recoveryMatched = expect.recoveryMatches === undefined || (
    clean(repair) && new RegExp(expect.recoveryMatches).test(textOf(repair))
  )
  let outputMatched = expect.outputJson === undefined
  if (expect.outputJson !== undefined && clean(first)) {
    try {
      outputMatched = isDeepStrictEqual(JSON.parse(textOf(first)), expect.outputJson)
    } catch {
      outputMatched = false
    }
  }
  return { firstCommandMatched, recoveryMatched, outputMatched }
}
