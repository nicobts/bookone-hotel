import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import { withUser } from '../../session'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import { recordTouch } from '../../../billing/attribution'
import { auditAttribution } from '../../../billing/audit'
import { buildReport, issueReport, previousPeriod } from '../../../billing/report'
import { raiseDispute, setSubscription } from '../../../billing/disputes'

/**
 * The invoice basis, against a real database (E5.4, D14, PRD C4).
 *
 * These rows become a bill sent to a hotel we are asking to trust us, so the
 * suite is written around the two ways this surface can fail in a way nobody
 * notices until an owner does:
 *
 *   - **A statement that changes between two readings.** Issuing freezes it,
 *     and the test that matters is the one that changes the underlying data
 *     afterwards and asserts the number did not move.
 *   - **A fee billed at the higher rate that the evidence does not support.**
 *     AG-07 exists for that, and its test credits real money back.
 */

let fixture: Fixture

async function bookedStay(
  propertyId: string,
  suffix: string,
  sessions: { engineSessionId?: string; conciergeSessionId?: string } = {},
): Promise<string> {
  const arrival = isoDate(Date.now() + 10 * 86_400_000)
  const departure = isoDate(Date.now() + 12 * 86_400_000)

  const [room] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = 'DBL'`,
  )

  const nights = []
  for (
    let t = Date.parse(`${arrival}T00:00:00Z`);
    t < Date.parse(`${departure}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    nights.push({ date, priceCents: 15_000, currency: 'EUR', snapshotId: `snap-${suffix}-${date}` })
  }

  const hold = await createHold({
    propertyId,
    roomTypeId: room!.id,
    arrival,
    departure,
    adults: 2,
    children: 0,
    nights,
    ...sessions,
  })
  if (hold.status !== 'held') throw new Error('fixture hold failed')

  await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: { name: 'Rosa Weber', email: `rosa-${suffix}@example.test`, locale: 'en' },
  })

  const confirmed = await confirmReservation({ propertyId, reservationId: hold.reservationId })
  if (confirmed.status !== 'confirmed') throw new Error(`fixture confirm: ${confirmed.status}`)

  return hold.reservationId
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** The month the fees just written land in, in the seed property's zone. */
function thisPeriod(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

beforeAll(async () => {
  fixture = await seed()
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('attribution', () => {
  it('bills a plain engine booking at the direct rate', async () => {
    const reservationId = await bookedStay(fixture.alpha.propertyId, 'direct', {
      engineSessionId: 'engine-direct',
    })

    const [fee] = await db.execute<{ kind: string; rate_bps: number }>(
      sql`select kind, rate_bps from fee_events where reservation_id = ${reservationId}`,
    )

    expect(fee?.kind).toBe('direct_booking')
  })

  it('bills a concierge booking with no prior engine session at the AI rate', async () => {
    const reservationId = await bookedStay(fixture.alpha.propertyId, 'attributed', {
      conciergeSessionId: 'concierge-clean',
    })

    const [fee] = await db.execute<{ kind: string; evidence: Record<string, unknown> }>(
      sql`select kind, evidence from fee_events where reservation_id = ${reservationId}`,
    )

    expect(fee?.kind).toBe('ai_attributed')
    expect(fee?.evidence.rule).toBe('d14-v1')
  })

  it('falls back to the direct rate when an engine session preceded the conversation', async () => {
    /*
     * The pair to the test above, and the one that costs us money.
     *
     * The engine touch is written first, an hour earlier, with no reservation
     * attached — the guest opened the booking engine, got stuck, and came back
     * through the chat in the same browser session. That row is the whole reason
     * `attribution_events` exists: no column on the reservation could record a
     * session that produced nothing.
     *
     * Same session id on purpose. An engine visit by a *different* guest does
     * not disqualify this booking — D14 says "no engine session preceded **it**"
     * — and the first version of this rule got that wrong in a way only a
     * database test with two bookings in it could show.
     */
    await recordTouch({
      propertyId: fixture.alpha.propertyId,
      sessionId: 'concierge-preceded',
      channel: 'engine',
      occurredAt: new Date(Date.now() - 3_600_000),
    })

    const reservationId = await bookedStay(fixture.alpha.propertyId, 'preceded', {
      conciergeSessionId: 'concierge-preceded',
    })

    const [fee] = await db.execute<{ kind: string; evidence: Record<string, unknown> }>(
      sql`select kind, evidence from fee_events where reservation_id = ${reservationId}`,
    )

    expect(fee?.kind).toBe('direct_booking')
    expect(String(fee?.evidence.reason)).toContain('engine session preceded')
  })

  it('records a touch for a hold, whether or not it converts', async () => {
    const [row] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from attribution_events
          where property_id = ${fixture.alpha.propertyId}`,
    )

    expect(row!.count).toBeGreaterThan(0)
  })
})

describe('the report', () => {
  it('separates the two fee kinds and sums them', async () => {
    const report = await buildReport({
      propertyId: fixture.alpha.propertyId,
      periodStart: thisPeriod(),
    })

    expect(report).not.toBeNull()

    const direct = report!.sections.find((section) => section.kind === 'direct_booking')
    const attributed = report!.sections.find((section) => section.kind === 'ai_attributed')

    expect(direct!.count).toBeGreaterThan(0)
    expect(attributed!.count).toBeGreaterThan(0)
    expect(report!.totalCents).toBe(
      report!.sections.reduce((total, section) => total + section.netCents, 0),
    )
  })

  it('shows an empty section rather than dropping it', async () => {
    // A month with no attributed bookings still shows the line at zero. An
    // owner who never sees it cannot form a view about whether the rate is
    // fair, and the first month it appears it looks like something new.
    const report = await buildReport({
      propertyId: fixture.beta.propertyId,
      periodStart: thisPeriod(),
    })

    expect(report!.sections.map((section) => section.kind)).toEqual([
      'subscription',
      'direct_booking',
      'ai_attributed',
    ])
  })

  it('carries the per-room equivalence once a subscription records rooms', async () => {
    await setSubscription({
      propertyId: fixture.alpha.propertyId,
      plan: 'standard',
      baseCents: 25_000,
      rooms: 20,
    })

    const report = await buildReport({
      propertyId: fixture.alpha.propertyId,
      periodStart: thisPeriod(),
    })

    expect(report!.rooms).toBe(20)
    // Fees included, per ADR-015: the number shown is the number billed.
    expect(report!.perRoomCents).toBe(Math.round(report!.totalCents / 20))
    expect(report!.perRoomCents).toBeGreaterThan(25_000 / 20)
  })

  it('has no per-room figure when the subscription does not record rooms', async () => {
    // Null rather than a count derived from `room_types`, which holds *types*.
    // A wrong number that looks authoritative, on the line built for comparison
    // against a competitor's price, is worse than no number.
    const report = await buildReport({
      propertyId: fixture.beta.propertyId,
      periodStart: thisPeriod(),
    })

    expect(report!.perRoomCents).toBeNull()
  })

  it('excludes a cancelled booking fee from the statement', async () => {
    const reservationId = await bookedStay(fixture.alpha.propertyId, 'cancelled', {
      engineSessionId: 'engine-cancelled',
    })

    const before = await buildReport({
      propertyId: fixture.alpha.propertyId,
      periodStart: thisPeriod(),
    })

    await db.execute(sql`update reservations set status = 'cancelled' where id = ${reservationId}`)

    const after = await buildReport({
      propertyId: fixture.alpha.propertyId,
      periodStart: thisPeriod(),
    })

    // The `fee_events` row survives — it records that we computed a fee — but
    // billing for a stay that did not happen is the least defensible line this
    // report could carry.
    expect(after!.totalCents).toBeLessThan(before!.totalCents)

    const [fee] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from fee_events where reservation_id = ${reservationId}`,
    )
    expect(fee!.count).toBe(1)
  })
})

describe('issuing freezes it', () => {
  it('returns the same numbers after the underlying data changes', async () => {
    const period = thisPeriod()

    const issued = await issueReport({ propertyId: fixture.alpha.propertyId, periodStart: period })
    expect(issued?.status).toBe('issued')

    const frozenTotal = issued!.report.totalCents

    // Something that would plainly change a recomputed statement.
    await bookedStay(fixture.alpha.propertyId, 'after-issue', {
      engineSessionId: 'engine-after-issue',
    })

    const reread = await buildReport({ propertyId: fixture.alpha.propertyId, periodStart: period })

    /*
     * The assertion the whole table exists for.
     *
     * A statement that showed a different number on the second reading would be
     * the fastest available way to lose the argument this surface is built to
     * win — and it would happen silently, to an owner holding a copy of the
     * first one.
     */
    expect(reread!.totalCents).toBe(frozenTotal)
    expect(reread!.status).toBe('issued')
  })

  it('does not restate an already-issued period', async () => {
    const period = thisPeriod()
    const again = await issueReport({ propertyId: fixture.alpha.propertyId, periodStart: period })

    expect(again?.status).toBe('already-issued')
  })
})

describe('disputes', () => {
  it('credits the fee when it is raised, with no adjudication step', async () => {
    const reservationId = await bookedStay(fixture.beta.propertyId, 'disputed', {
      conciergeSessionId: 'concierge-disputed',
    })

    const [fee] = await db.execute<{ id: string; fee_cents: number }>(
      sql`select id, fee_cents from fee_events where reservation_id = ${reservationId}`,
    )

    const outcome = await raiseDispute({
      propertyId: fixture.beta.propertyId,
      feeEventId: fee!.id,
      userId: fixture.beta.user.id,
      reason: 'This guest had already called us.',
    })

    expect(outcome.status).toBe('credited')
    // D14 resolves disputes in the owner's favour. Implemented literally: the
    // money comes off when they say so, and the conversation happens after.
    expect(outcome).toMatchObject({ creditCents: fee!.fee_cents })
  })

  it('is idempotent — a double tap is one disagreement', async () => {
    const reservationId = await bookedStay(fixture.beta.propertyId, 'disputed-twice', {
      conciergeSessionId: 'concierge-twice',
    })

    const [fee] = await db.execute<{ id: string }>(
      sql`select id from fee_events where reservation_id = ${reservationId}`,
    )

    await raiseDispute({
      propertyId: fixture.beta.propertyId,
      feeEventId: fee!.id,
      userId: fixture.beta.user.id,
    })
    const second = await raiseDispute({
      propertyId: fixture.beta.propertyId,
      feeEventId: fee!.id,
      userId: fixture.beta.user.id,
    })

    expect(second.status).toBe('already-disputed')
  })

  it('shows the credit on the draft statement', async () => {
    const report = await buildReport({
      propertyId: fixture.beta.propertyId,
      periodStart: thisPeriod(),
    })

    const attributed = report!.sections.find((section) => section.kind === 'ai_attributed')

    expect(attributed!.creditCents).toBeGreaterThan(0)
    expect(attributed!.netCents).toBe(attributed!.grossCents - attributed!.creditCents)
  })

  it('refuses a fee belonging to another property', async () => {
    const [fee] = await db.execute<{ id: string }>(
      sql`select id from fee_events where property_id = ${fixture.alpha.propertyId} limit 1`,
    )

    const outcome = await raiseDispute({
      propertyId: fixture.beta.propertyId,
      feeEventId: fee!.id,
      userId: fixture.beta.user.id,
    })

    expect(outcome.status).toBe('rejected')
  })
})

describe('AG-07, the attribution auditor', () => {
  it('finds nothing when the evidence still holds', async () => {
    const report = await auditAttribution({
      propertyId: fixture.alpha.propertyId,
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 60_000),
    })

    // It should always find nothing: fees are computed from the same rule at
    // confirmation. A finding means the two paths have diverged, which is
    // exactly what nobody would otherwise notice until an owner did.
    expect(report.findings).toEqual([])
  })

  it('re-runs the rule from the instant it was originally applied', async () => {
    /*
     * The regression test for the bug this auditor found in its own codebase.
     *
     * The fee path computes the verdict with `new Date()` before opening its
     * transaction; `fee_events.created_at` is the database's `now()`, set
     * milliseconds later — and the row's timestamp came out *earlier* than the
     * concierge touch it had been classified from. Auditing against
     * `created_at` closed the window before the evidence, so every attributed
     * fee looked unsupported and would have been credited back nightly.
     *
     * Forced here by moving `created_at` a full minute before the touch, which
     * is far larger than the millisecond skew that produced it.
     */
    const reservationId = await bookedStay(fixture.alpha.propertyId, 'clock-skew', {
      conciergeSessionId: 'concierge-skew',
    })

    await db.execute(sql`
      update fee_events set created_at = created_at - interval '1 minute'
      where reservation_id = ${reservationId}
    `)

    const report = await auditAttribution({
      propertyId: fixture.alpha.propertyId,
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 60_000),
    })

    const [fee] = await db.execute<{ id: string }>(
      sql`select id from fee_events where reservation_id = ${reservationId}`,
    )

    expect(report.findings.map((finding) => finding.feeEventId)).not.toContain(fee!.id)
  })

  it('credits a fee whose evidence no longer supports it', async () => {
    const reservationId = await bookedStay(fixture.alpha.propertyId, 'audit-target', {
      conciergeSessionId: 'concierge-audited',
    })

    const [fee] = await db.execute<{ id: string; kind: string; fee_cents: number }>(
      sql`select id, kind, fee_cents from fee_events where reservation_id = ${reservationId}`,
    )
    expect(fee?.kind).toBe('ai_attributed')

    /*
     * Plant the evidence that would have disqualified it, backdated to before
     * the conversation.
     *
     * This is what a late-arriving touch looks like: the same browser session,
     * written by a surface that reported it after the booking path had already
     * classified the stay. The fee was billed at the higher rate on evidence
     * that is no longer complete, and the auditor is what notices.
     */
    await db.execute(sql`
      insert into attribution_events (property_id, session_id, channel, occurred_at)
      values (
        ${fixture.alpha.propertyId},
        'concierge-audited',
        'engine',
        now() - interval '2 hours'
      )
    `)

    const report = await auditAttribution({
      propertyId: fixture.alpha.propertyId,
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 60_000),
      credit: true,
    })

    expect(report.findings.map((finding) => finding.feeEventId)).toContain(fee!.id)
    expect(report.creditedCents).toBeGreaterThanOrEqual(fee!.fee_cents)

    const [dispute] = await db.execute<{ credit_cents: number; raised_by: string | null }>(
      sql`select credit_cents, raised_by from fee_disputes where fee_event_id = ${fee!.id}`,
    )

    expect(dispute?.credit_cents).toBe(fee!.fee_cents)
    // Nobody raised it. The property never had to notice, which is the point.
    expect(dispute?.raised_by).toBeNull()
  })

  it('does not credit the same fee twice', async () => {
    const second = await auditAttribution({
      propertyId: fixture.alpha.propertyId,
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 60_000),
      credit: true,
    })

    // An auditor that ran nightly and re-credited would make the same
    // concession every night for the rest of the property's life.
    expect(second.creditedCents).toBe(0)
  })
})

describe('isolation', () => {
  it('shows a member their own fees and reports', async () => {
    expect((await selectAs(fixture.alpha.user, 'fee_events')).length).toBeGreaterThan(0)
    expect((await selectAs(fixture.alpha.user, 'monthly_reports')).length).toBeGreaterThan(0)
  })

  it('shows the other property none of them', async () => {
    const reports = (await selectAs(fixture.beta.user, 'monthly_reports')) as {
      property_id: string
    }[]

    expect(reports.every((row) => row.property_id === fixture.beta.propertyId)).toBe(true)
  })

  it('shows the other property no attribution events', async () => {
    const events = (await selectAs(fixture.beta.user, 'attribution_events')) as {
      property_id: string
    }[]

    expect(events.every((row) => row.property_id === fixture.beta.propertyId)).toBe(true)
  })

  it('refuses an attribution event written from a session', async () => {
    /*
     * These rows decide whether a booking is billed at 2–4% or 8–12%. One
     * writable from a session would let somebody manufacture "an engine session
     * preceded this" and move a fee down — or delete one and move it up. Either
     * way, the invoice would rest on a table a party to it could edit.
     */
    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into attribution_events (property_id, session_id, channel, occurred_at)
          values (${fixture.alpha.propertyId}, 'forged', 'engine', now())
        `),
      ),
    )
  })

  it('refuses a dispute raised in somebody else’s name', async () => {
    const [fee] = await db.execute<{ id: string }>(
      sql`select id from fee_events where property_id = ${fixture.alpha.propertyId} limit 1`,
    )

    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into fee_disputes (property_id, fee_event_id, raised_by, status, credit_cents)
          values (${fixture.alpha.propertyId}, ${fee!.id}, ${fixture.beta.user.id}, 'open', 0)
        `),
      ),
    )
  })

  it('refuses a report issued from a session', async () => {
    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into monthly_reports (property_id, period_start, status, total_cents)
          values (${fixture.alpha.propertyId}, '2020-01-01', 'draft', 999999)
        `),
      ),
    )
  })
})

describe('period arithmetic', () => {
  it('rolls back across a year boundary', () => {
    expect(previousPeriod('Europe/Rome', new Date('2027-01-15T12:00:00Z'))).toBe('2026-12-01')
  })

  it('rolls back inside a year', () => {
    expect(previousPeriod('Europe/Rome', new Date('2026-09-15T12:00:00Z'))).toBe('2026-08-01')
  })
})
