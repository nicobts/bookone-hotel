import { describe, expect, it } from 'vitest'
import {
  ALERT_REACHES,
  DEFAULT_ALERT_LADDER,
  alertsToFire,
  dueRung,
  readAlertLadder,
  rungOf,
  validateAlertLadder,
  type AlertLadder,
  type AlertReach,
} from './alerts'
import { alloggiatiCapabilities } from './alloggiati'
import { registrationDeadline } from './deadlines'
import {
  ALERTING_STATES,
  advance,
  escalateIfLate,
  type LifecycleRow,
  type Next,
  type ObligationState,
} from './lifecycle'
import type { SubmitResult } from './adapter'

/**
 * The alert ladder on a fake clock (WP1.5 acceptance):
 *
 * - alerts fire at the configured offsets, and nothing fires twice;
 * - zero missed 24h Alloggiati deadlines across a 30-day simulation with
 *   injected failures.
 *
 * Pure: the same `dueRung` and `alertsToFire` the sweep calls, and the same
 * `advance` and `escalateIfLate` the runner calls, driven minute by minute. The
 * database half — the rung claimed by a conditional update, the messages
 * queued — is `db/__tests__/rls/compliance-alerts.test.ts`.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const SWEEP = 5 * MINUTE

const deadline = new Date('2026-10-02T12:00:00Z')

function at(minutesBeforeDeadline: number): Date {
  return new Date(deadline.getTime() - minutesBeforeDeadline * MINUTE)
}

describe('the ladder, read from settings', () => {
  it('defaults to 12, 6 and 3 hours before the deadline', () => {
    expect(readAlertLadder({})).toEqual({ inbox: 720, staff: 360, owner: 180 })
    expect(readAlertLadder(null)).toEqual(DEFAULT_ALERT_LADDER)
  })

  it('takes a property override over the defaults, key by key', () => {
    expect(readAlertLadder({ complianceAlerts: { staff: 240 } })).toEqual({
      inbox: 720,
      staff: 240,
      owner: 180,
    })
    expect(readAlertLadder({ complianceAlerts: { owner: null } })).toEqual({
      inbox: 720,
      staff: 360,
      owner: null,
    })
  })

  it('never half-applies a bad setting: a typo cannot switch the alerts off', () => {
    for (const bad of [
      { staff: 0 },
      { staff: -60 },
      { owner: 25 * 60 },
      { staff: '6h' },
      { staf: 360 },
      // Owner before staff is the wrong way round.
      { staff: 120, owner: 300 },
    ]) {
      expect(readAlertLadder({ complianceAlerts: bad })).toEqual(DEFAULT_ALERT_LADDER)
      expect(validateAlertLadder(bad).ok).toBe(false)
    }
    expect(validateAlertLadder({ inbox: 600, staff: 300, owner: 150 }).ok).toBe(true)
  })
})

describe('which rung is due (fake clock)', () => {
  const ladder = DEFAULT_ALERT_LADDER
  const open = { state: 'pending' as ObligationState, deadline }

  it.each([
    [13 * 60, 0],
    [12 * 60 + 1, 0],
    [12 * 60, rungOf('inbox')],
    [6 * 60 + 1, rungOf('inbox')],
    [6 * 60, rungOf('staff')],
    [3 * 60 + 1, rungOf('staff')],
    [3 * 60, rungOf('owner')],
    [1, rungOf('owner')],
  ])('%i minutes before the deadline → rung %i', (minutes, rung) => {
    expect(dueRung(open, ladder, at(minutes))).toBe(rung)
  })

  it('never after expiry', () => {
    expect(dueRung(open, ladder, at(0))).toBe(0)
    expect(dueRung(open, ladder, at(-60))).toBe(0)
    expect(dueRung({ state: 'manual', deadline }, ladder, at(-1))).toBe(0)
  })

  it('never for a filing the authority already has', () => {
    for (const state of ['submitted', 'acknowledged'] as const) {
      expect(dueRung({ state, deadline }, ladder, at(60))).toBe(0)
    }
  })

  it('a hand-over goes straight to the staff, whatever the clock says', () => {
    expect(dueRung({ state: 'manual', deadline }, ladder, at(20 * 60))).toBe(rungOf('staff'))
    expect(dueRung({ state: 'manual', deadline }, ladder, at(60))).toBe(rungOf('owner'))
  })

  it('a hand-over with the staff rung off goes to the owner', () => {
    const noStaff: AlertLadder = { ...ladder, staff: null }
    expect(dueRung({ state: 'manual', deadline }, noStaff, at(20 * 60))).toBe(rungOf('owner'))
  })

  it('a rung switched off is passed over, not fired', () => {
    const noInbox: AlertLadder = { ...ladder, inbox: null }
    expect(dueRung(open, noInbox, at(8 * 60))).toBe(0)
    expect(alertsToFire(0, rungOf('staff'), noInbox)).toEqual(['staff'])
  })

  it('a late start fires every rung that would have fired by now, once', () => {
    expect(alertsToFire(0, rungOf('owner'), ladder)).toEqual(['inbox', 'staff', 'owner'])
    expect(alertsToFire(rungOf('inbox'), rungOf('owner'), ladder)).toEqual(['staff', 'owner'])
    expect(alertsToFire(rungOf('owner'), rungOf('owner'), ladder)).toEqual([])
  })
})

describe('a sweep every five minutes for a day', () => {
  it('fires each rung once, within one sweep of its offset', () => {
    const ladder: AlertLadder = { inbox: 600, staff: 240, owner: 90 }
    const fired: { reach: AlertReach; at: Date }[] = []
    let rung = 0

    // From a day before the deadline to an hour after it, with the sweep
    // running twice per tick — a retried job, a second worker — to prove the
    // stored rung is what stops a repeat.
    for (let t = deadline.getTime() - 24 * HOUR; t <= deadline.getTime() + HOUR; t += SWEEP) {
      for (const _run of [1, 2]) {
        const now = new Date(t)
        const due = dueRung({ state: 'pending', deadline }, ladder, now)
        if (due <= rung) continue
        for (const reach of alertsToFire(rung, due, ladder)) fired.push({ reach, at: now })
        rung = due
      }
    }

    expect(fired.map((f) => f.reach)).toEqual(['inbox', 'staff', 'owner'])
    for (const { reach, at: when } of fired) {
      const offset = ladder[reach]!
      const lateBy = when.getTime() - (deadline.getTime() - offset * MINUTE)
      expect(lateBy).toBeGreaterThanOrEqual(0)
      expect(lateBy).toBeLessThan(SWEEP)
      expect(when.getTime()).toBeLessThan(deadline.getTime())
    }
  })
})

// ---------------------------------------------------------------------------
// Thirty days, with failures
// ---------------------------------------------------------------------------

/** Mulberry32: a seeded generator, so the simulation is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

interface SimObligation extends LifecycleRow {
  id: number
  nextAttemptAt: Date | null
  /** When a person confirmed the guests against their documents; null for never. */
  confirmedAt: Date | null
  alertRung: number
  alerts: { reach: AlertReach; at: Date }[]
  /** When the channel will answer a filing it has. */
  answerAt: Date | null
  /** When a person files by hand, once one has been paged about a hand-over. */
  handFiledAt: Date | null
  acknowledgedAt: Date | null
  everManual: boolean
}

describe('thirty days of arrivals with injected failures', () => {
  it('misses no 24h Alloggiati deadline, and escalates only before expiry', () => {
    const rand = random(20260928)
    const policy = alloggiatiCapabilities(true).retryPolicy
    const ladder = DEFAULT_ALERT_LADDER
    const start = new Date('2026-10-01T00:00:00Z')
    const end = new Date(start.getTime() + 31 * 24 * HOUR)

    /*
     * Channel outages: six windows of 2 to 10 hours at random through the
     * month, plus a 15% chance that any single call fails anyway and a 3%
     * chance it is refused outright (not retryable). Answers come back after
     * 0–40 minutes.
     */
    const outages = Array.from({ length: 6 }, () => {
      const from = start.getTime() + rand() * 30 * 24 * HOUR
      return { from, to: from + (2 + rand() * 8) * HOUR }
    })
    const down = (now: Date) => outages.some((o) => now.getTime() >= o.from && now.getTime() < o.to)

    function file(o: SimObligation, now: Date): SubmitResult {
      if (down(now) || rand() < 0.15) {
        return { status: 'failed', code: 'unavailable', message: 'Channel down', retryable: true }
      }
      if (rand() < 0.03) {
        return { status: 'failed', code: 'rejected', message: 'Refused', retryable: false }
      }
      o.answerAt = new Date(now.getTime() + rand() * 40 * MINUTE)
      return { status: 'submitted', reference: `R-${o.id}` }
    }

    function ask(o: SimObligation, now: Date): SubmitResult {
      if (down(now))
        return { status: 'failed', code: 'unavailable', message: 'down', retryable: true }
      return o.answerAt && now >= o.answerAt
        ? { status: 'acknowledged', reference: `R-${o.id}`, receipt: { ok: true } }
        : { status: 'submitted', reference: `R-${o.id}` }
    }

    // Arrivals: 0–6 a day, at 12:00–23:59 Rome time. Documents confirmed by a
    // person before arrival (65%), 0–20 hours after (30%), or never (5%).
    const obligations: SimObligation[] = []
    const arrivalsAt: Date[] = []
    for (let day = 0; day < 30; day++) {
      const count = Math.floor(rand() * 7)
      for (let i = 0; i < count; i++) {
        arrivalsAt.push(new Date(start.getTime() + day * 24 * HOUR + (10 + rand() * 11.9) * HOUR))
      }
    }
    arrivalsAt.sort((a, b) => a.getTime() - b.getTime())

    const pending = [...arrivalsAt]
    const apply = (o: SimObligation, next: Next, now: Date) => {
      o.state = next.state
      o.attempts = next.attempts
      o.nextAttemptAt = next.nextAttemptAt
      o.lastError = next.lastError
      if (next.state === 'manual') o.everManual = true
      if (next.state === 'acknowledged' && !o.acknowledgedAt) o.acknowledgedAt = now
    }

    for (let t = start.getTime(); t < end.getTime(); t += SWEEP) {
      const now = new Date(t)

      // Generation: the obligation exists from the arrival.
      while (pending.length > 0 && pending[0]!.getTime() <= t) {
        const arrivedAt = pending.shift()!
        const roll = rand()
        const arrivalDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(
          arrivedAt,
        )
        obligations.push({
          id: obligations.length + 1,
          state: 'pending',
          attempts: 0,
          deadline: registrationDeadline({ arrivalDate, timeZone: 'Europe/Rome', arrivedAt }),
          lastError: null,
          nextAttemptAt: now,
          confirmedAt:
            roll < 0.65
              ? arrivedAt
              : roll < 0.95
                ? new Date(arrivedAt.getTime() + rand() * 20 * HOUR)
                : null,
          alertRung: 0,
          alerts: [],
          answerAt: null,
          handFiledAt: null,
          acknowledgedAt: null,
          everManual: false,
        })
      }

      for (const o of obligations) {
        // A person, once paged about a hand-over, files by hand within 0–90
        // minutes: the margin is two hours, and this is the assumption the
        // margin is sized for. Paged about missing data at the staff rung,
        // they confirm the documents within 0–3 hours.
        if (o.state === 'manual' && o.alertRung >= rungOf('staff')) {
          o.handFiledAt ??= new Date(t + rand() * 90 * MINUTE)
          if (now >= o.handFiledAt) {
            apply(
              o,
              advance(
                o,
                {
                  kind: 'submitted',
                  result: {
                    status: 'acknowledged',
                    reference: `M-${o.id}`,
                    receipt: { manual: true },
                  },
                },
                policy,
                now,
              ),
              now,
            )
          }
        }
        if (o.state === 'pending' && !o.confirmedAt && o.alertRung >= rungOf('staff')) {
          o.confirmedAt = new Date(t + rand() * 3 * HOUR)
        }

        // The runner's step, as `runObligation` takes it.
        if (o.state !== 'acknowledged' && o.state !== 'manual') {
          if (!o.nextAttemptAt || o.nextAttemptAt <= now) {
            if (o.state === 'submitted') {
              apply(o, advance(o, { kind: 'submitted', result: ask(o, now) }, policy, now), now)
            } else {
              const late = escalateIfLate(o, policy, now)
              if (late) apply(o, late, now)
              else if (!o.confirmedAt || o.confirmedAt > now) {
                apply(
                  o,
                  advance(
                    o,
                    { kind: 'invalid', issues: [{ code: 'x', message: 'Not confirmed' }] },
                    policy,
                    now,
                  ),
                  now,
                )
              } else {
                if (o.state === 'pending') o.state = 'queued'
                apply(o, advance(o, { kind: 'submitted', result: file(o, now) }, policy, now), now)
              }
            }
          }
        }

        // The ladder, as `alertDueObligations` runs it.
        const due = dueRung(o, readAlertLadder({}), now)
        if (due > o.alertRung) {
          for (const reach of alertsToFire(o.alertRung, due, ladder))
            o.alerts.push({ reach, at: now })
          o.alertRung = due
        }
      }
    }

    // Every arrival produced an obligation and every one was met in time.
    expect(obligations.length).toBe(arrivalsAt.length)
    expect(obligations.length).toBeGreaterThan(60)
    const missed = obligations.filter(
      (o) => !o.acknowledgedAt || o.acknowledgedAt.getTime() > o.deadline.getTime(),
    )
    expect(missed.map((o) => ({ id: o.id, state: o.state }))).toEqual([])

    // The failures were real: some filings went to a person, some retried.
    expect(obligations.filter((o) => o.everManual).length).toBeGreaterThan(0)
    expect(obligations.filter((o) => o.attempts > 1).length).toBeGreaterThan(0)

    for (const o of obligations) {
      // Nothing fired twice, and nothing fired at or after the deadline.
      const reaches = o.alerts.map((a) => a.reach)
      expect(new Set(reaches).size).toBe(reaches.length)
      for (const alert of o.alerts) expect(alert.at.getTime()).toBeLessThan(o.deadline.getTime())
      // Every hand-over reached a person's phone before its deadline.
      if (o.everManual) expect(reaches).toContain('staff')
      expect(ALERT_REACHES).toEqual(expect.arrayContaining(reaches))
      expect([...ALERTING_STATES, 'submitted', 'acknowledged']).toContain(o.state)
    }
  })
})
