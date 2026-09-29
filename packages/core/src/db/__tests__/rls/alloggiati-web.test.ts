import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import { FakeAlloggiatiAdapter } from './fake-alloggiati-adapter'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import { applyJourneyCommand } from '../../../journey/apply'
import { recordDocument, saveParty } from '../../../journey/precheckin'
import { confirmDocuments } from '../../../journey/confirm'
import { grantEntitlement } from '../../../onboarding/entitlements'
import { createResolver, loadCodeTables, type CodeResolver } from '../../../alloggiati/codes'
import {
  alloggiatiManualFallback,
  createAlloggiatiComplianceAdapter,
} from '../../../compliance/alloggiati'
import {
  generateGuestRegistrations,
  retryManualObligation,
  runObligation,
} from '../../../compliance/obligations'
import { localDate, reconcileAlloggiatiDay } from '../../../compliance/reconcile'

/**
 * WP1.2 against a real database: the registry's codes resolved before anything
 * is sent, and the outage drill (retries, then a person, then evidence once
 * the channel files it). The channel is core's test fake carrying the
 * synthetic code tables; the Alloggiati Web adapter itself is tested against
 * its simulator in `@bookone/adapters`. Nothing is filed with any authority.
 */
const TABLES = fileURLToPath(
  new URL('../../../../../../content/alloggiati/synthetic', import.meta.url),
)

let fixture: Fixture
let codes: CodeResolver

beforeAll(async () => {
  fixture = await seed()
  await grantEntitlement({ propertyId: fixture.alpha.propertyId, feature: 'alloggiati' })
  codes = createResolver(await loadCodeTables(TABLES))
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** A stay arriving today, its one guest born in Italy, confirmed by a person. */
async function stayBornIn(birthPlace: string): Promise<string> {
  const propertyId = fixture.alpha.propertyId
  const arrival = isoDate(Date.now())
  const departure = isoDate(Date.now() + 2 * 86_400_000)
  const [room] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = 'DBL'`,
  )
  const hold = await createHold({
    propertyId,
    roomTypeId: room!.id,
    arrival,
    departure,
    adults: 1,
    children: 0,
    nights: [arrival, isoDate(Date.now() + 86_400_000)].map((date) => ({
      date,
      priceCents: 10_000,
      currency: 'EUR',
      snapshotId: `snap-${date}`,
    })),
  })
  if (hold.status !== 'held') throw new Error('fixture hold failed')
  const reservationId = hold.reservationId
  await attachGuest({
    propertyId,
    reservationId,
    guest: { name: 'Maria Rossi', email: `maria-${reservationId}@example.test`, locale: 'it' },
  })
  await confirmReservation({ propertyId, reservationId })
  await saveParty({
    propertyId,
    reservationId,
    members: [
      {
        guestIndex: 0,
        surname: 'Rossi',
        givenName: 'Maria',
        sex: 'f',
        birthDate: '1980-04-12',
        birthPlace,
        birthCountry: 'IT',
        citizenship: 'IT',
        documentType: 'idCard',
        documentNumber: 'CA00000AA',
        documentIssuer: 'Trieste',
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
  const confirmed = await confirmDocuments({
    propertyId,
    reservationId,
    userId: fixture.alpha.user.id,
  })
  if (confirmed.status !== 'confirmed') throw new Error(`fixture confirm: ${confirmed.status}`)
  return reservationId
}

async function obligationFor(reservationId: string) {
  const [row] = await db.execute<{
    id: string
    state: string
    attempts: number
    deadline: string
    last_error: string | null
  }>(sql`select * from compliance_obligations where reservation_id = ${reservationId}`)
  return row!
}

describe('the registry’s codes, before anything is sent', () => {
  it('holds a birthplace the registry does not know, with a message the desk can act on', async () => {
    const channel = new FakeAlloggiatiAdapter({ codes })
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await stayBornIn('Tristee')
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)

    await runObligation({ adapters }, row.id)
    const held = await obligationFor(reservationId)
    expect(held.state).toBe('pending')
    expect(held.last_error).toMatch(/Guest 1: birthPlace — “Tristee” is not a comune/)
    expect(channel.submitCount).toBe(0)

    // The desk corrects it with the guest; the next run files the codes.
    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [
        {
          guestIndex: 0,
          surname: 'Rossi',
          givenName: 'Maria',
          sex: 'f',
          birthDate: '1980-04-12',
          birthPlace: 'Trieste',
          birthCountry: 'IT',
          citizenship: 'IT',
          documentType: 'idCard',
          documentNumber: 'CA00000AA',
          documentIssuer: 'Trieste',
        },
      ],
    })
    await confirmDocuments({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      userId: fixture.alpha.user.id,
    })
    await runObligation({ adapters }, row.id)
    expect((await obligationFor(reservationId)).state).toBe('acknowledged')
    expect(channel.payloads[0]).toContain('SYN000001')
    expect(channel.payloads[0]).toContain('SYNID')
    expect(channel.payloads[0]).not.toContain('TRIESTE')
  })
})

describe('the outage drill', () => {
  it('retries, hands the filing to a person, and records the channel’s receipt once it files', async () => {
    const channel = new FakeAlloggiatiAdapter({ codes, failSubmitTimes: 100 })
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await stayBornIn('Trieste')
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)
    const deadline = new Date(row.deadline).getTime()

    // 1. The channel is down: retried.
    expect(
      await runObligation({ adapters, now: () => new Date(deadline - 10 * 3_600_000) }, row.id),
    ).toMatchObject({ to: 'failed' })
    // 2. Two hours before the deadline: handed to a person, the file ready.
    expect(
      await runObligation({ adapters, now: () => new Date(deadline - 90 * 60_000) }, row.id),
    ).toMatchObject({ to: 'manual' })
    const fallback = await alloggiatiManualFallback({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      codes,
    })
    expect(fallback.content).toContain('SYN000001')

    // 3. Still down when the desk tries the channel: it stays with them, with the reason.
    const input = {
      propertyId: fixture.alpha.propertyId,
      obligationId: row.id,
      userId: fixture.alpha.user.id,
    }
    expect(await retryManualObligation({ adapters }, input)).toEqual({
      status: 'still-manual',
      message: 'injected channel failure',
    })
    expect((await obligationFor(reservationId)).state).toBe('manual')

    // 4. The outage is over: the channel files it, and its receipt is the evidence.
    channel.failSubmitTimes = 0
    expect(await retryManualObligation({ adapters }, input)).toEqual({ status: 'acknowledged' })
    expect((await obligationFor(reservationId)).state).toBe('acknowledged')
    const [evidence] = await db.execute<{ source: string }>(
      sql`select source from compliance_evidence where obligation_id = ${row.id}`,
    )
    expect(evidence).toEqual({ source: 'channel' })
    const [retried] = await db.execute<{ actor: string; payload: { outcome: string } }>(sql`
      select actor, payload from domain_events
       where entity_id = ${row.id} and event_type = 'compliance_obligation.channel_retried'
       order by id desc limit 1`)
    expect(retried).toMatchObject({
      actor: `user:${fixture.alpha.user.id}`,
      payload: { outcome: 'acknowledged' },
    })

    // Filed once, however many times anyone pressed the button.
    expect(channel.submitCount).toBe(1)
    expect(await retryManualObligation({ adapters }, input)).toEqual({ status: 'not-manual' })
  })

  it('sends nothing when the record does not pass, and says why on the stay', async () => {
    const channel = new FakeAlloggiatiAdapter({ codes })
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await stayBornIn('Tristee')
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)
    // Near the deadline it goes to a person without being validated.
    await runObligation(
      { adapters, now: () => new Date(new Date(row.deadline).getTime() - 60 * 60_000) },
      row.id,
    )
    expect((await obligationFor(reservationId)).state).toBe('manual')

    const result = await retryManualObligation(
      { adapters },
      { propertyId: fixture.alpha.propertyId, obligationId: row.id, userId: fixture.alpha.user.id },
    )
    expect(result.status).toBe('invalid')
    const after = await obligationFor(reservationId)
    expect(after.state).toBe('manual')
    expect(after.last_error).toMatch(/“Tristee” is not a comune/)
    expect(channel.submitCount).toBe(0)

    const [retried] = await db.execute<{ actor: string; payload: { outcome: string } }>(sql`
      select actor, payload from domain_events
       where entity_id = ${row.id} and event_type = 'compliance_obligation.channel_retried'`)
    expect(retried).toMatchObject({
      actor: `user:${fixture.alpha.user.id}`,
      payload: { outcome: 'invalid' },
    })
  })

  it('will not retry another property’s filing', async () => {
    const channel = new FakeAlloggiatiAdapter({ codes })
    const adapters = new Map([['alloggiati', createAlloggiatiComplianceAdapter(channel)]])
    const reservationId = await stayBornIn('Trieste')
    await generateGuestRegistrations({ adapters }, { limit: 50, reservationId })
    const row = await obligationFor(reservationId)
    expect(
      await retryManualObligation(
        { adapters },
        { propertyId: fixture.beta.propertyId, obligationId: row.id, userId: fixture.beta.user.id },
      ),
    ).toEqual({ status: 'unavailable', reason: 'unknown' })
  })
})

describe('the daily reconciliation', () => {
  it('counts the day, and calls a missing receipt a mismatch', async () => {
    const channel = new FakeAlloggiatiAdapter({ codes })
    const [{ timezone }] = (await db.execute<{ timezone: string }>(
      sql`select timezone from properties where id = ${fixture.alpha.propertyId}`,
    )) as unknown as [{ timezone: string }]
    // The property's calendar day, which is what reconciliation counts in.
    const today = localDate(new Date(), timezone)

    const agrees = await reconcileAlloggiatiDay(
      { adapter: channel },
      { propertyId: fixture.alpha.propertyId, day: today },
    )
    // Two filings acknowledged by the channel today, above.
    expect(agrees).toMatchObject({ filedThisDay: 2, channelReceipt: 'available', mismatch: false })

    channel.receiptAvailable = false
    const missing = await reconcileAlloggiatiDay(
      { adapter: channel },
      { propertyId: fixture.alpha.propertyId, day: today },
    )
    expect(missing).toMatchObject({ channelReceipt: 'missing', mismatch: true })

    const [event] = await db.execute<{ payload: Record<string, unknown> }>(sql`
      select payload from domain_events
       where property_id = ${fixture.alpha.propertyId} and event_type = 'compliance.reconciled'
       order by id desc limit 1`)
    expect(event!.payload).toMatchObject({ mismatch: true, day: today })
    // Counts only: no guest, no reference.
    expect(JSON.stringify(event!.payload)).not.toMatch(/ROSSI|Rossi|FAKE-/)

    // By deadline: tomorrow's filings are due tomorrow, and all acknowledged
    // but the one left with a person above.
    const due = await reconcileAlloggiatiDay(
      { adapter: channel },
      {
        propertyId: fixture.alpha.propertyId,
        day: localDate(new Date(Date.now() + 86_400_000), timezone),
      },
    )
    expect(due.due).toBeGreaterThanOrEqual(3)
    expect(due.byChannel).toBe(2)

    // With no day, the property's own yesterday: nothing filed there.
    const yesterday = await reconcileAlloggiatiDay(
      { adapter: channel },
      { propertyId: fixture.alpha.propertyId },
    )
    expect(yesterday.day).toBe(localDate(new Date(Date.now() - 86_400_000), timezone))
  })

  it('bounds a day by local midnight, so a 25-hour day is counted whole', () => {
    // 2026-10-25 in Rome: summer time ends, the day is 25 hours long.
    expect(localDate(new Date('2026-10-24T22:30:00Z'), 'Europe/Rome')).toBe('2026-10-25')
    expect(localDate(new Date('2026-10-25T22:30:00Z'), 'Europe/Rome')).toBe('2026-10-25')
    expect(localDate(new Date('2026-10-25T23:30:00Z'), 'Europe/Rome')).toBe('2026-10-26')
  })
})
