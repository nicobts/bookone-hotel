import type { ComplianceCapabilities, ComplianceIssue, SubmitResult } from './adapter'

/**
 * The obligation lifecycle (ADR-039): every state change, as one pure
 * function. `obligations.ts` reads a row, asks the adapter, calls `advance`,
 * and writes what comes back; nothing else decides a state.
 *
 *   pending ──valid──▶ queued ──submit──▶ submitted ──ack──▶ acknowledged
 *      │                 │  ▲                 │
 *      │                 ▼  │ retry           │ (asked again until it answers)
 *      │               failed ─exhausted─▶ manual ──receipt recorded──▶ acknowledged
 *      └──── still invalid near the deadline ──▶ manual
 *
 * Two rules carry the Phase 1 gate (zero missed 24h deadlines):
 * - **Escalate before the deadline, never after.** Inside the adapter's
 *   `manualBeforeDeadlineMinutes` no automatic attempt starts; the obligation
 *   goes to a person while there is still time for them to act.
 * - **A filed obligation is not re-filed.** `submitted` only ever asks the
 *   channel again (the adapter's idempotent submit); it never falls back to
 *   manual, because the authority already has it.
 */

export type ObligationState =
  'pending' | 'queued' | 'submitted' | 'acknowledged' | 'failed' | 'manual'

/** Every legal move. `advance` never returns one outside this table; a test holds it to that. */
export const TRANSITIONS: Readonly<Record<ObligationState, readonly ObligationState[]>> = {
  pending: ['pending', 'queued', 'manual'],
  queued: ['pending', 'submitted', 'acknowledged', 'failed', 'manual'],
  submitted: ['submitted', 'acknowledged'],
  failed: ['pending', 'queued', 'submitted', 'acknowledged', 'failed', 'manual'],
  manual: ['acknowledged'],
  acknowledged: [],
}

export const FINAL_STATES: readonly ObligationState[] = ['acknowledged']

/**
 * States that still need someone to act, which is what the alert ladder and
 * the exceptions inbox watch (WP1.5). `submitted` is not one: the authority has
 * it, and only the channel's answer is outstanding.
 */
export const ALERTING_STATES: readonly ObligationState[] = ['pending', 'queued', 'failed', 'manual']

/** How often an obligation waiting on data, or on an answer, is looked at again. */
export const RECHECK_SECONDS = 10 * 60

export interface LifecycleRow {
  state: ObligationState
  attempts: number
  deadline: Date
  lastError?: string | null
}

export type Outcome =
  /** The adapter found the data incomplete: staff must fix something first. */
  | { kind: 'invalid'; issues: ComplianceIssue[] }
  /** The adapter was asked to file (or asked again). */
  | { kind: 'submitted'; result: SubmitResult }

export interface Next {
  state: ObligationState
  attempts: number
  /** When the sweep should run it again; null when nothing will happen without a person. */
  nextAttemptAt: Date | null
  lastError: string | null
}

type Policy = ComplianceCapabilities['retryPolicy']

/** Whether an automatic attempt may still start, or it is a person's now. */
export function tooLate(deadline: Date, policy: Policy, at: Date): boolean {
  return at.getTime() >= deadline.getTime() - policy.manualBeforeDeadlineMinutes * 60_000
}

/** The wait before attempt `attempt + 1`: backoff, doubling, capped. */
export function backoff(attempt: number, policy: Policy): number {
  const seconds = policy.backoffSeconds * 2 ** Math.max(0, attempt - 1)
  return Math.min(seconds, policy.maxBackoffSeconds)
}

export function advance(row: LifecycleRow, outcome: Outcome, policy: Policy, now: Date): Next {
  if (row.state === 'acknowledged') {
    return { state: 'acknowledged', attempts: row.attempts, nextAttemptAt: null, lastError: null }
  }

  if (outcome.kind === 'invalid') {
    const lastError = outcome.issues.map((issue) => issue.message).join(' · ')
    // Filed already, or with a person: missing data now changes nothing.
    if (row.state === 'submitted' || row.state === 'manual') {
      return { state: row.state, attempts: row.attempts, nextAttemptAt: null, lastError }
    }
    if (tooLate(row.deadline, policy, now)) {
      return { state: 'manual', attempts: row.attempts, nextAttemptAt: null, lastError }
    }
    return {
      state: 'pending',
      attempts: row.attempts,
      nextAttemptAt: new Date(now.getTime() + RECHECK_SECONDS * 1000),
      lastError,
    }
  }

  const result = outcome.result

  if (row.state === 'pending') {
    // A programming error, not a runtime state: the runner queues a pending
    // obligation (its own transition and event) before it files anything.
    throw new Error('compliance: an obligation is filed from queued or failed, never from pending')
  }

  if (result.status === 'acknowledged') {
    return {
      state: 'acknowledged',
      attempts: row.state === 'submitted' ? row.attempts : row.attempts + 1,
      nextAttemptAt: null,
      lastError: null,
    }
  }

  if (row.state === 'manual') {
    // With a person. Only an acknowledgement moves it; anything else is noted.
    return {
      state: 'manual',
      attempts: row.attempts,
      nextAttemptAt: null,
      lastError: result.status === 'failed' ? result.message : (row.lastError ?? null),
    }
  }

  if (result.status === 'submitted') {
    // The channel has it. Ask again until it answers; a pending answer is not
    // a failure and never becomes one.
    return {
      state: 'submitted',
      attempts: row.state === 'submitted' ? row.attempts : row.attempts + 1,
      nextAttemptAt: new Date(now.getTime() + RECHECK_SECONDS * 1000),
      lastError: null,
    }
  }

  // Failed.
  if (row.state === 'submitted') {
    // Asking about a filing failed. The filing stands; ask again later.
    return {
      state: 'submitted',
      attempts: row.attempts,
      nextAttemptAt: new Date(now.getTime() + RECHECK_SECONDS * 1000),
      lastError: result.message,
    }
  }

  const attempts = row.attempts + 1
  const retryAt = new Date(now.getTime() + backoff(attempts, policy) * 1000)

  if (
    !result.retryable ||
    attempts >= policy.maxAttempts ||
    tooLate(row.deadline, policy, retryAt)
  ) {
    return { state: 'manual', attempts, nextAttemptAt: null, lastError: result.message }
  }

  return { state: 'failed', attempts, nextAttemptAt: retryAt, lastError: result.message }
}

/**
 * The move a sweep makes on an obligation it will not attempt: one that is
 * still `pending` or `failed` when the manual margin opens goes to a person.
 */
export function escalateIfLate(row: LifecycleRow, policy: Policy, now: Date): Next | null {
  if (row.state !== 'pending' && row.state !== 'failed' && row.state !== 'queued') return null
  if (!tooLate(row.deadline, policy, now)) return null
  return {
    state: 'manual',
    attempts: row.attempts,
    nextAttemptAt: null,
    lastError: row.lastError ?? null,
  }
}
