import { describe, expect, it } from 'vitest'
import { auditMessage, flattenToolOutputs, numbersIn } from '../audit'

/**
 * The tool-boundary audit (E3.2 acceptance criterion, binding rule 7).
 *
 * The sprint gate is zero violations in production. These tests are the other
 * half of that claim: they prove the check can actually *find* one. A gate that
 * always reads zero because the detector is broken is worse than no gate, since
 * it is reported as evidence.
 *
 * So every case here comes in a pair — something that must pass, and the
 * smallest adjacent thing that must fail.
 */

const evidence = [
  [{ tool: 'search_kb', ok: true }],
  { phrase: 'Breakfast is served from 07:30 to 10:00 in the dining room.', score: 0.9 },
]

const message = (body: string, overrides: Partial<Parameters<typeof auditMessage>[0]> = {}) =>
  auditMessage({
    messageId: 'm1',
    threadId: 't1',
    agentRunId: 'r1',
    body,
    runEvidence: evidence,
    ...overrides,
  })

describe('numbersIn', () => {
  it('keeps a time whole', () => {
    // Split into "10" and "00" this would pass on the strength of a tool having
    // said "10" anywhere, which is the entire failure the check exists for.
    expect(numbersIn('breakfast at 07:30')).toEqual(['07:30'])
  })

  it('keeps a price and a date whole', () => {
    expect(numbersIn('EUR 12.50 on 2026-09-12')).toEqual(['12.50', '2026-09-12'])
  })

  it('finds a bare number', () => {
    expect(numbersIn('room 4')).toEqual(['4'])
  })

  it('finds nothing in a sentence with no numbers', () => {
    expect(numbersIn('the sauna is on the top floor')).toEqual([])
  })
})

describe('flattenToolOutputs', () => {
  it('reaches values nested anywhere in the run record', () => {
    const flat = flattenToolOutputs([{ a: { b: ['deep value', 7] } }])

    expect(flat).toContain('deep value')
    expect(flat).toContain('7')
  })

  it('returns nothing for a run with no tool calls', () => {
    expect(flattenToolOutputs(null)).toBe('')
    expect(flattenToolOutputs('not an array')).toBe('')
  })
})

describe('auditMessage', () => {
  it('passes a reply that is a tool phrase, verbatim', () => {
    expect(message('Breakfast is served from 07:30 to 10:00 in the dining room.')).toEqual([])
  })

  it('passes through a difference in whitespace and case', () => {
    // Line wrapping and capitalisation are presentation. Flagging them would
    // produce noise that trains somebody to ignore the report.
    expect(message('breakfast is served from   07:30 to 10:00 in the dining room.')).toEqual([])
  })

  it('flags a helpful rephrasing', () => {
    const kinds = message('Breakfast runs 07:30-10:00 downstairs.').map((v) => v.kind)

    expect(kinds).toContain('unsourced_reply')
  })

  it('flags an invented number even inside a correctly-sourced-looking sentence', () => {
    const violations = message('Breakfast is served from 07:30 to 10:30 in the dining room.')

    expect(violations.map((v) => v.kind)).toContain('unsourced_number')
    expect(violations.map((v) => v.detail)).toContain('10:30')
  })

  it('does not flag a number the tool produced somewhere other than the phrase', () => {
    // The evidence includes `score: 0.9`. A reply quoting a phrase that happens
    // to contain "0.9" is sourced; provenance is the question, not presentation.
    expect(message('Breakfast is served from 07:30 to 10:00 in the dining room.')).toEqual([])
  })

  it('flags an agent message with no run behind it', () => {
    const violations = message('Breakfast is at eight.', { agentRunId: null, runEvidence: [] })

    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('no_run')
  })

  it('flags a reply against an empty run rather than passing it', () => {
    // A run that recorded no tool calls cannot have sourced anything. Treating
    // "no evidence" as "nothing to contradict" is how an audit reads clean on
    // exactly the runs that went wrong.
    const violations = message('Breakfast is at 08:00.', { runEvidence: [] })

    expect(violations.map((v) => v.kind)).toContain('unsourced_reply')
  })

  it('names the message and thread, so a violation can be read in context', () => {
    const [violation] = message('Something else entirely.')

    expect(violation?.messageId).toBe('m1')
    expect(violation?.threadId).toBe('t1')
    expect(violation?.agentRunId).toBe('r1')
  })
})
