import { describe, expect, it } from 'vitest'
import type { SubmitResult } from './adapter'
import {
  TRANSITIONS,
  advance,
  backoff,
  escalateIfLate,
  tooLate,
  type ObligationState,
  type Outcome,
} from './lifecycle'

const policy = {
  maxAttempts: 3,
  backoffSeconds: 60,
  maxBackoffSeconds: 300,
  manualBeforeDeadlineMinutes: 120,
}

const now = new Date('2026-10-01T10:00:00Z')
const inHours = (hours: number) => new Date(now.getTime() + hours * 3_600_000)

const submitted: SubmitResult = { status: 'submitted', reference: 'R1' }
const acknowledged: SubmitResult = {
  status: 'acknowledged',
  reference: 'R1',
  receipt: { ok: true },
}
const transient: SubmitResult = { status: 'failed', code: 'x', message: 'down', retryable: true }
const permanent: SubmitResult = {
  status: 'failed',
  code: 'x',
  message: 'bad field',
  retryable: false,
}

const outcomes: Outcome[] = [
  { kind: 'invalid', issues: [{ code: 'missing', message: 'Surname missing' }] },
  { kind: 'submitted', result: submitted },
  { kind: 'submitted', result: acknowledged },
  { kind: 'submitted', result: transient },
  { kind: 'submitted', result: permanent },
]

const states: ObligationState[] = [
  'pending',
  'queued',
  'submitted',
  'acknowledged',
  'failed',
  'manual',
]

describe('the lifecycle', () => {
  it('never makes a move outside the transition table, from any state, on any outcome', () => {
    for (const state of states) {
      for (const outcome of outcomes) {
        for (const deadline of [inHours(24), inHours(1), inHours(-1)]) {
          for (const attempts of [0, 2, 5]) {
            if (state === 'pending' && outcome.kind === 'submitted') {
              expect(() => advance({ state, attempts, deadline }, outcome, policy, now)).toThrow()
              continue
            }
            const next = advance({ state, attempts, deadline }, outcome, policy, now)
            if (next.state === state) continue
            expect(TRANSITIONS[state], `${state} → ${next.state}`).toContain(next.state)
          }
        }
      }
    }
  })

  it('acknowledged is final', () => {
    for (const outcome of outcomes) {
      expect(
        advance({ state: 'acknowledged', attempts: 1, deadline: inHours(24) }, outcome, policy, now)
          .state,
      ).toBe('acknowledged')
    }
  })

  it('a filed obligation is never re-filed or escalated: it only waits for the answer', () => {
    for (const outcome of outcomes) {
      const next = advance(
        { state: 'submitted', attempts: 1, deadline: inHours(-5) },
        outcome,
        policy,
        now,
      )
      expect(['submitted', 'acknowledged']).toContain(next.state)
    }
  })

  it('counts an attempt when it files, not when it asks', () => {
    expect(
      advance(
        { state: 'queued', attempts: 0, deadline: inHours(24) },
        { kind: 'submitted', result: submitted },
        policy,
        now,
      ).attempts,
    ).toBe(1)
    expect(
      advance(
        { state: 'submitted', attempts: 1, deadline: inHours(24) },
        { kind: 'submitted', result: submitted },
        policy,
        now,
      ).attempts,
    ).toBe(1)
    expect(
      advance(
        { state: 'submitted', attempts: 1, deadline: inHours(24) },
        { kind: 'submitted', result: acknowledged },
        policy,
        now,
      ).attempts,
    ).toBe(1)
  })

  it('retries a transient failure with backoff, then hands it to a person', () => {
    const first = advance(
      { state: 'queued', attempts: 0, deadline: inHours(24) },
      { kind: 'submitted', result: transient },
      policy,
      now,
    )
    expect(first).toMatchObject({ state: 'failed', attempts: 1, lastError: 'down' })
    expect(first.nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000)

    const second = advance(
      { state: 'failed', attempts: 1, deadline: inHours(24) },
      { kind: 'submitted', result: transient },
      policy,
      now,
    )
    expect(second.state).toBe('failed')
    expect(second.nextAttemptAt?.getTime()).toBe(now.getTime() + 120_000)

    const third = advance(
      { state: 'failed', attempts: 2, deadline: inHours(24) },
      { kind: 'submitted', result: transient },
      policy,
      now,
    )
    expect(third).toMatchObject({ state: 'manual', attempts: 3, nextAttemptAt: null })
  })

  it('sends a permanent failure straight to a person', () => {
    expect(
      advance(
        { state: 'queued', attempts: 0, deadline: inHours(24) },
        { kind: 'submitted', result: permanent },
        policy,
        now,
      ),
    ).toMatchObject({ state: 'manual', lastError: 'bad field' })
  })

  it('does not schedule a retry that would start inside the manual margin', () => {
    // 2h01m left, a one-minute backoff lands at 2h00m: inside the margin.
    const deadline = new Date(now.getTime() + 121 * 60_000)
    expect(
      advance(
        { state: 'queued', attempts: 0, deadline },
        { kind: 'submitted', result: transient },
        policy,
        now,
      ).state,
    ).toBe('manual')
  })

  it('waits for missing data, then hands it to a person before the deadline', () => {
    const invalid: Outcome = { kind: 'invalid', issues: [{ code: 'c', message: 'Not confirmed' }] }
    const waiting = advance(
      { state: 'pending', attempts: 0, deadline: inHours(24) },
      invalid,
      policy,
      now,
    )
    expect(waiting).toMatchObject({ state: 'pending', lastError: 'Not confirmed' })
    expect(waiting.nextAttemptAt).not.toBeNull()

    expect(
      advance({ state: 'pending', attempts: 0, deadline: inHours(1) }, invalid, policy, now).state,
    ).toBe('manual')
  })

  it('escalates late obligations, and leaves filed ones alone', () => {
    expect(
      escalateIfLate(
        { state: 'pending', attempts: 0, deadline: inHours(1), lastError: 'x' },
        policy,
        now,
      ),
    ).toMatchObject({
      state: 'manual',
      lastError: 'x',
    })
    expect(
      escalateIfLate({ state: 'failed', attempts: 1, deadline: inHours(1) }, policy, now)?.state,
    ).toBe('manual')
    expect(
      escalateIfLate({ state: 'pending', attempts: 0, deadline: inHours(3) }, policy, now),
    ).toBeNull()
    expect(
      escalateIfLate({ state: 'submitted', attempts: 1, deadline: inHours(-1) }, policy, now),
    ).toBeNull()
  })

  it('doubles the backoff and caps it', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => backoff(attempt, policy))).toEqual([
      60, 120, 240, 300, 300,
    ])
  })

  it('is too late exactly at the margin', () => {
    expect(tooLate(inHours(2), policy, now)).toBe(true)
    expect(tooLate(new Date(inHours(2).getTime() + 1), policy, now)).toBe(false)
  })
})
