import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { withUser } from '../../session'
import { expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import { FakeAlloggiatiAdapter } from './fake-alloggiati-adapter'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import { applyJourneyCommand } from '../../../journey/apply'
import { recordDocument, saveParty } from '../../../journey/precheckin'
import { confirmDocuments } from '../../../journey/confirm'
import { stageAlloggiati } from '../../../alloggiati/submit'
import { grantEntitlement, revokeEntitlement } from '../../../onboarding/entitlements'
import type {
  ComplianceAdapter,
  ComplianceCapabilities,
  ObligationInput,
  SubmitResult,
} from '../../../compliance/adapter'
import {
  createAlloggiatiComplianceAdapter,
  alloggiatiManualFallback,
} from '../../../compliance/alloggiati'
import { registrationDeadline } from '../../../compliance/deadlines'
import {
  generateGuestRegistrations,
  listDueObligations,
  listObligationsForStay,
  receiptHash,
  recordManualFiling,
  runObligation,
} from '../../../compliance/obligations'

/**
 * Compliance obligations against a real database (ADR-039, WP1.1).
 *
 * MEMO: nothing is filed with any authority. The channels here are local fakes:
 * `FakeAlloggiatiAdapter` behind the real Alloggiati bridge, and a
 * `ScriptedAdapter` for the lifecycle's retry and hand-over paths. Everything
 * else is the shipping path — generation, the conditional state writes, the
 * events with their wait times, the evidence and its hash, RLS, and the
 * append-only guard.
 */

let fixture: Fixture

/** A lifecycle stand-in with the registry's national id, scripted per call. */
class ScriptedAdapter implements ComplianceAdapter {
  script: SubmitResult[] = []
  submits = 0
  capabilities(): ComplianceCapabilities {
    return {
      id: 'alloggiati',
      authority: 'questura',
      feature: 'alloggiati',
      jurisdiction: { level: 'national', country: 'IT' },
      obligationTypes: ['guest_registration'],
      transport: 'web_service',
      evidenceType: 'receipt',
      retryPolicy: {
        maxAttempts: 3,
        backoffSeconds: 60,
        maxBackoffSeconds: 600,
        manualBeforeDeadlineMinutes: 120,
      },
      manualFallback: { contentType: 'text/plain', description: 'Scripted.' },
      simulated: true,
    }
  }
  async validate() {
    return { ok: true as const }
  }
  async submit(_obligation: ObligationInput): Promise<SubmitResult> {
    this.submits += 1
    return (
      this.script.shift() ?? {
        status: 'acknowledged',
        reference: `S-${randomUUID().slice(0, 8)}`,
        receipt: { scripted: true },
      }
    )
  }
  async manualFallback() {
    return { filename: 'x.txt', contentType: 'text/plain', content: 'x', instructions: ['Do it.'] }
  }
}

beforeAll(async () => {
  fixture = await seed()
  for (const property of [fixture.alpha, fixture.beta]) {
    await grantEntitlement({ propertyId: property.propertyId, feature: 'alloggiati' })
  }
})

afterAll(async () => {
  await closeConnection()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function confirmedStay(propertyId: string): Promise<string> {
  const arrival = isoDate(Date.now())
  const departure = isoDate(Date.now() + 2 * 86_400_000)
  const [room] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = 'DBL'`,
  )
  const nights = [arrival, isoDate(Date.now() + 86_400_000)].map((date) => ({
    date,
    priceCents: 10_000,
    currency: 'EUR',
    snapshotId: `snap-${date}`,
  }))
  const hold = await createHold({
    propertyId,
    roomTypeId: room!.id,
    arrival,
    departure,
    adults: 1,
    children: 0,
    nights,
  })
  if (hold.status !== 'held') throw new Error('fixture hold failed')
  await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: { name: 'Rosa Weber', email: `rosa-${hold.reservationId}@example.test`, locale: 'en' },
  })
  const confirmed = await confirmReservation({ propertyId, reservationId: hold.reservationId })
  if (confirmed.status !== 'confirmed') throw new Error(`fixture confirm: ${confirmed.status}`)
  return hold.reservationId
}

/** A party of one, complete, with its document, arrived. Not yet confirmed by a person. */
async function arrivedStay(propertyId: string): Promise<string> {
  const reservationId = await confirmedStay(propertyId)
  await saveParty({
    propertyId,
    reservationId,
    members: [
      {
        guestIndex: 0,
        surname: 'Weber',
        givenName: 'Rosa',
        sex: 'f',
        birthDate: '1985-04-12',
        birthCountry: 'AT',
        citizenship: 'AT',
        documentType: 'passport',
        documentNumber: 'P1234567',
      },
    ],
  })
  await recordDocument({
    propertyId,
    reservationId,
    guestIndex: 0,
    documentPath: `${propertyId}/${reservationId}/0`,
  })
  await applyJourneyCommand({ propertyId, reservationId, command: { type: 'arrival.confirm' } })
  return reservationId
}

async function confirmedByStaff(propertyId: string, userId: string): Promise<string> {
  const reservationId = await arrivedStay(propertyId)
  const outcome = await confirmDocuments({ propertyId, reservationId, userId })
  if (outcome.status !== 'confirmed') throw new Error(`fixture confirmDocuments: ${outcome.status}`)
  return reservationId
}

async function obligationFor(reservationId: string) {
  const [row] = await db.execute<{
    id: string
    state: string
    attempts: number
    deadline: string
    last_error: string | null
    next_attempt_at: string | null
  }>(sql`select * from compliance_obligations where reservation_id = ${reservationId}`)
  return row
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('generating obligations', () => {
  it('creates one pending guest registration for an arrived stay, once', async () => {
    const adapters = new Map([['alloggiati', new ScriptedAdapter()]])
    const reservationId = await arrivedStay(fixture.alpha.propertyId)

    const first = await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const second = await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })

    expect(first.created).toBe(1)
    expect(second.created).toBe(0)

    const row = await obligationFor(reservationId)
    expect(row?.state).toBe('pending')

    // 24 hours from the recorded arrival, capped at the end of the arrival
    // day (deadlines.test.ts has the cases; this checks the wiring).
    const [stay] = await db.execute<{ at: string; arrival_date: string; timezone: string }>(
      sql`select e.at, r.arrival_date::text, p.timezone
          from domain_events e
          join reservations r on r.id = e.entity_id
          join properties p on p.id = r.property_id
          where e.entity_type = 'journey' and e.entity_id = ${reservationId} and e.event_type = 'arrival.confirm'`,
    )
    expect(new Date(row!.deadline).getTime()).toBe(
      registrationDeadline({
        arrivalDate: stay!.arrival_date,
        timeZone: stay!.timezone,
        arrivedAt: new Date(stay!.at),
      }).getTime(),
    )
  })

  it('creates nothing for a property without the feature (ADR-019)', async () => {
    const adapters = new Map([['alloggiati', new ScriptedAdapter()]])
    await revokeEntitlement({ propertyId: fixture.beta.propertyId, feature: 'alloggiati' })
    try {
      const reservationId = await arrivedStay(fixture.beta.propertyId)
      const result = await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
      expect(result.created).toBe(0)
      expect(await obligationFor(reservationId)).toBeUndefined()
    } finally {
      await grantEntitlement({ propertyId: fixture.beta.propertyId, feature: 'alloggiati' })
    }
  })

  it('reports a registry entry with no implementation instead of creating an obligation', async () => {
    const reservationId = await arrivedStay(fixture.alpha.propertyId)
    const result = await generateGuestRegistrations(
      { adapters: new Map() },
      { limit: 50, reservationId },
    )
    expect(result.created).toBe(0)
    expect(result.unsupported).toEqual([
      { propertyId: fixture.alpha.propertyId, adapter: 'alloggiati' },
    ])
  })
})

// ---------------------------------------------------------------------------
// The Alloggiati bridge, end to end
// ---------------------------------------------------------------------------

describe('filing a guest registration through the Alloggiati bridge', () => {
  it('waits while nobody has confirmed the guests against their documents', async () => {
    const channel = new FakeAlloggiatiAdapter()
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await arrivedStay(fixture.alpha.propertyId)

    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)
    const result = await runObligation({ adapters }, row!.id)

    expect(result).toEqual({ status: 'unchanged', state: 'pending' })
    expect((await obligationFor(reservationId))?.last_error).toMatch(/confirmed/)
    expect(channel.submitCount).toBe(0)
  })

  it('files once confirmed, stores the receipt as evidence, and never files twice', async () => {
    const channel = new FakeAlloggiatiAdapter()
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await confirmedByStaff(fixture.alpha.propertyId, fixture.alpha.user.id)

    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)

    expect(await runObligation({ adapters }, row!.id)).toEqual({
      status: 'advanced',
      from: 'queued',
      to: 'acknowledged',
    })
    expect(await runObligation({ adapters }, row!.id)).toEqual({
      status: 'skipped',
      reason: 'final',
    })
    expect(channel.submitCount).toBe(1)

    const [submission] = await db.execute<{ status: string; receipt: Record<string, unknown> }>(
      sql`select status, receipt from alloggiati_submissions where reservation_id = ${reservationId}`,
    )
    expect(submission?.status).toBe('acknowledged')

    const [evidence] = await db.execute<{
      source: string
      receipt: Record<string, unknown>
      receipt_hash: string
    }>(
      sql`select source, receipt, receipt_hash from compliance_evidence where obligation_id = ${row!.id}`,
    )
    expect(evidence?.source).toBe('channel')
    expect(evidence?.receipt).toEqual(submission?.receipt)
    expect(evidence?.receipt_hash).toBe(receiptHash(submission!.receipt))

    const [ref] = await db.execute<{ external_id: string }>(
      sql`select external_id from external_refs where entity_type = 'compliance_obligation' and entity_id = ${row!.id}`,
    )
    expect(ref?.external_id).toMatch(/^FAKE-/)

    // Every transition is an event with its wait time (the ADR-025 data).
    const events = await db.execute<{ event_type: string; payload: Record<string, unknown> }>(
      sql`select event_type, payload from domain_events where entity_id = ${row!.id} order by id`,
    )
    expect(events.map((event) => event.event_type)).toEqual([
      'compliance_obligation.created',
      'compliance_obligation.queued',
      'compliance_evidence.recorded',
      'compliance_obligation.acknowledged',
    ])
    expect(events[1]!.payload).toMatchObject({ from: 'pending', to: 'queued', simulated: true })
    expect(typeof events[3]!.payload.waitedSeconds).toBe('number')
  })

  it('asks a queued channel again until it answers, without re-filing', async () => {
    const channel = new FakeAlloggiatiAdapter({ pendingChecks: 1 })
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await confirmedByStaff(fixture.alpha.propertyId, fixture.alpha.user.id)

    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)

    expect(await runObligation({ adapters }, row!.id)).toMatchObject({ to: 'submitted' })
    const later = () => new Date(Date.now() + 11 * 60_000)
    let result = await runObligation({ adapters, now: later }, row!.id)
    for (let asked = 0; result.status !== 'advanced' && asked < 5; asked += 1) {
      result = await runObligation({ adapters, now: later }, row!.id)
    }
    expect(result).toMatchObject({ status: 'advanced', from: 'submitted', to: 'acknowledged' })
    expect(channel.submitCount).toBe(1)
  })

  it('builds the manual fallback from the same records as the filing', async () => {
    const reservationId = await confirmedByStaff(fixture.alpha.propertyId, fixture.alpha.user.id)
    const fallback = await alloggiatiManualFallback({
      propertyId: fixture.alpha.propertyId,
      reservationId,
    })

    // What the filing path stages for the same stay, byte for byte.
    const staged = await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: 'fallback-check',
    })
    expect(staged.status).toBe('staged')
    const [submission] = await db.execute<{ payload: string }>(
      sql`select payload from alloggiati_submissions where reservation_id = ${reservationId} and channel = 'fallback-check'`,
    )
    expect(fallback.content).toBe(submission!.payload)
    expect(fallback.contentType).toBe('text/plain')
    expect(fallback.instructions.length).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// Retries, hand-over, manual filing
// ---------------------------------------------------------------------------

describe('when the channel fails', () => {
  it('retries with backoff, then hands the obligation to a person', async () => {
    const adapter = new ScriptedAdapter()
    const adapters = new Map([['alloggiati', adapter]])
    const reservationId = await arrivedStay(fixture.alpha.propertyId)
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)

    const down: SubmitResult = {
      status: 'failed',
      code: 'unavailable',
      message: 'down',
      retryable: true,
    }
    adapter.script = [down, down, down]

    const t0 = Date.now()
    expect(await runObligation({ adapters, now: () => new Date(t0) }, row!.id)).toMatchObject({
      to: 'failed',
    })
    const failed = await obligationFor(reservationId)
    expect(failed).toMatchObject({ attempts: 1, last_error: 'down' })
    expect(new Date(failed!.next_attempt_at!).getTime()).toBe(t0 + 60_000)

    // Not due before its time; due after.
    const early = await listDueObligations({ limit: 500, now: new Date(t0 + 30_000) })
    expect(early.some((due) => due.id === row!.id)).toBe(false)
    const due = await listDueObligations({ limit: 500, now: new Date(t0 + 61_000) })
    expect(due.some((item) => item.id === row!.id)).toBe(true)

    await runObligation({ adapters, now: () => new Date(t0 + 61_000) }, row!.id)
    expect(
      await runObligation({ adapters, now: () => new Date(t0 + 200_000) }, row!.id),
    ).toMatchObject({
      to: 'manual',
    })
    expect(await obligationFor(reservationId)).toMatchObject({ state: 'manual', attempts: 3 })
    expect(adapter.submits).toBe(3)
  })

  it('goes to a person without an attempt once inside the margin before the deadline', async () => {
    const adapter = new ScriptedAdapter()
    const adapters = new Map([['alloggiati', adapter]])
    const reservationId = await arrivedStay(fixture.alpha.propertyId)
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)

    const nearDeadline = () => new Date(new Date(row!.deadline).getTime() - 60 * 60_000)
    expect(await runObligation({ adapters, now: nearDeadline }, row!.id)).toMatchObject({
      to: 'manual',
    })
    expect(adapter.submits).toBe(0)
  })

  it('a person files by hand and records the proof', async () => {
    const adapter = new ScriptedAdapter()
    adapter.script = [{ status: 'failed', code: 'rejected', message: 'bad', retryable: false }]
    const adapters = new Map([['alloggiati', adapter]])
    const reservationId = await arrivedStay(fixture.alpha.propertyId)
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)
    await runObligation({ adapters }, row!.id)
    expect((await obligationFor(reservationId))?.state).toBe('manual')

    const recorded = await recordManualFiling({
      propertyId: fixture.alpha.propertyId,
      obligationId: row!.id,
      userId: fixture.alpha.user.id,
      receipt: { protocol: 'Q-2026-001', note: 'Uploaded by hand' },
    })
    expect(recorded.status).toBe('recorded')
    expect((await obligationFor(reservationId))?.state).toBe('acknowledged')

    const [evidence] = await db.execute<{ source: string; recorded_by: string }>(
      sql`select source, recorded_by from compliance_evidence where obligation_id = ${row!.id}`,
    )
    expect(evidence).toEqual({ source: 'manual', recorded_by: fixture.alpha.user.id })

    // Another property's obligation cannot be closed from here.
    expect(
      await recordManualFiling({
        propertyId: fixture.beta.propertyId,
        obligationId: row!.id,
        userId: fixture.beta.user.id,
        receipt: { protocol: 'x' },
      }),
    ).toEqual({ status: 'rejected', reason: 'unknown obligation' })
  })
})

// ---------------------------------------------------------------------------
// Isolation and the append-only guard
// ---------------------------------------------------------------------------

describe('isolation', () => {
  it('a member sees their property’s obligations and evidence, never another’s — both paths', async () => {
    const adapters = new Map([['alloggiati', new ScriptedAdapter()]])
    const alphaStay = await arrivedStay(fixture.alpha.propertyId)
    const betaStay = await arrivedStay(fixture.beta.propertyId)
    for (const reservationId of [alphaStay, betaStay]) {
      await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
      await runObligation({ adapters }, (await obligationFor(reservationId))!.id)
    }

    // Client path (PostgREST).
    const obligations = (await selectAs(fixture.alpha.user, 'compliance_obligations')) as {
      property_id: string
    }[]
    const evidence = (await selectAs(fixture.alpha.user, 'compliance_evidence')) as {
      property_id: string
    }[]
    expect(obligations.length).toBeGreaterThan(0)
    expect(evidence.length).toBeGreaterThan(0)
    expect(obligations.every((row) => row.property_id === fixture.alpha.propertyId)).toBe(true)
    expect(evidence.every((row) => row.property_id === fixture.alpha.propertyId)).toBe(true)

    // Drizzle path (withUser): asking for beta's stay by id returns zero rows.
    expect(
      await listObligationsForStay(fixture.alpha.user.id, fixture.beta.propertyId, betaStay),
    ).toEqual([])
    expect(
      await listObligationsForStay(fixture.alpha.user.id, fixture.alpha.propertyId, alphaStay),
    ).toHaveLength(1)
  })

  it('no member can write either table', async () => {
    const [obligation] = await db.execute<{ id: string }>(
      sql`select id from compliance_obligations where property_id = ${fixture.alpha.propertyId} limit 1`,
    )
    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(
          sql`insert into compliance_evidence (property_id, obligation_id, source, receipt, receipt_hash) values (${fixture.alpha.propertyId}, ${obligation!.id}, 'manual', '{}'::jsonb, 'x')`,
        ),
      ),
    )
    const updated = await withUser(fixture.alpha.user.id, (tx) =>
      tx.execute(
        sql`update compliance_obligations set state = 'acknowledged' where id = ${obligation!.id} returning id`,
      ),
    )
    expect(updated).toHaveLength(0)
  })
})

describe('evidence is append-only', () => {
  async function someEvidence(): Promise<string> {
    const [row] = await db.execute<{ id: string }>(
      sql`select id from compliance_evidence where property_id = ${fixture.alpha.propertyId} and receipt_purged_at is null limit 1`,
    )
    return row!.id
  }

  it('refuses an edit, even under the service role', async () => {
    const id = await someEvidence()
    await expect(
      db.execute(sql`update compliance_evidence set receipt_hash = 'forged' where id = ${id}`),
    ).rejects.toThrow()
    await expect(
      db.execute(
        sql`update compliance_evidence set receipt = '{"forged":true}'::jsonb where id = ${id}`,
      ),
    ).rejects.toThrow()
  })

  it('refuses a delete while the property exists', async () => {
    const id = await someEvidence()
    await expect(
      db.execute(sql`delete from compliance_evidence where id = ${id}`),
    ).rejects.toThrow()
  })

  it('allows only the retention purge: receipt blanked, hash kept', async () => {
    const id = await someEvidence()
    const [before] = await db.execute<{ receipt_hash: string }>(
      sql`select receipt_hash from compliance_evidence where id = ${id}`,
    )
    await db.execute(
      sql`update compliance_evidence set receipt = '{}'::jsonb, receipt_purged_at = now() where id = ${id}`,
    )
    const [after] = await db.execute<{ receipt: unknown; receipt_hash: string }>(
      sql`select receipt, receipt_hash from compliance_evidence where id = ${id}`,
    )
    expect(after).toEqual({ receipt: {}, receipt_hash: before!.receipt_hash })

    // Once.
    await expect(
      db.execute(sql`update compliance_evidence set receipt_purged_at = now() where id = ${id}`),
    ).rejects.toThrow()
  })

  it('goes with its property, and only then', async () => {
    const [property] = await db.execute<{ id: string }>(
      sql`insert into properties (slug, name) values (${`gone-${randomUUID().slice(0, 8)}`}, 'Gone') returning id`,
    )
    const [obligation] = await db.execute<{ id: string }>(
      sql`insert into compliance_obligations (property_id, adapter_id, authority, type, subject_key, period_date, deadline)
          values (${property!.id}, 'alloggiati', 'questura', 'istat_movement', 'day:2026-10-01', '2026-10-01', now()) returning id`,
    )
    await db.execute(
      sql`insert into compliance_evidence (property_id, obligation_id, source, receipt, receipt_hash)
          values (${property!.id}, ${obligation!.id}, 'channel', '{"a":1}'::jsonb, 'h')`,
    )

    await db.execute(sql`delete from properties where id = ${property!.id}`)
    const [left] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from compliance_evidence where property_id = ${property!.id}`,
    )
    expect(left!.n).toBe(0)
  })
})
