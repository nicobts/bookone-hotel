import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import { applyJourneyCommand, readJourney } from '../../../journey/apply'
import {
  listPrecheckinDue,
  recordDocument,
  resolveStay,
  saveParty,
  setExpectedArrival,
} from '../../../journey/precheckin'
import { sendPrecheckinInvite } from '../../../journey/invite'
import { signStayToken } from '../../../journey/token'

/**
 * The guest journey against a real database (ADR-013, E2.1, E2.2).
 *
 * Two things these tests exist to hold in place:
 *
 *   1. **Nothing writes `journey_states` except the machine** (binding rule 4).
 *      The state is only ever reached through a command, and the command always
 *      emits its event in the same transaction.
 *   2. **A token is scoped to exactly one stay.** The pre-arrival surface has no
 *      session, so the token resolver is the entire boundary — and it is tested
 *      by pointing it at things it should refuse.
 */

let fixture: Fixture

const SECRET = 'a-test-secret-that-is-long-enough-to-be-accepted'
let originalSecret: string | undefined

/** A confirmed stay, arriving in three days, with a guest attached. */
async function confirmedStay(propertyId: string, arrivalOffsetDays = 3): Promise<string> {
  const arrival = isoDate(Date.now() + arrivalOffsetDays * 86_400_000)
  const departure = isoDate(Date.now() + (arrivalOffsetDays + 2) * 86_400_000)

  const [room] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = 'DBL'`,
  )

  const hold = await createHold({
    propertyId,
    roomTypeId: room!.id,
    arrival,
    departure,
    adults: 2,
    children: 0,
    nights: nightsBetween(arrival, departure),
  })

  if (hold.status !== 'held') throw new Error('fixture hold failed')

  await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: { name: 'Rosa Weber', email: `rosa-${hold.reservationId}@example.test`, locale: 'de' },
  })

  const confirmed = await confirmReservation({ propertyId, reservationId: hold.reservationId })
  if (confirmed.status !== 'confirmed') throw new Error(`fixture confirm: ${confirmed.status}`)

  return hold.reservationId
}

function nightsBetween(arrival: string, departure: string) {
  const nights = []
  for (
    let t = Date.parse(`${arrival}T00:00:00Z`);
    t < Date.parse(`${departure}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    nights.push({ date, priceCents: 10_000, currency: 'EUR', snapshotId: `snap-${date}` })
  }

  return nights
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

beforeAll(async () => {
  originalSecret = process.env.STAY_TOKEN_SECRET
  process.env.STAY_TOKEN_SECRET = SECRET
  fixture = await seed()
})

afterAll(async () => {
  if (originalSecret === undefined) delete process.env.STAY_TOKEN_SECRET
  else process.env.STAY_TOKEN_SECRET = originalSecret

  await closeConnection()
})

describe('the journey starts with the booking', () => {
  it('is created by confirmation, in the same transaction', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)

    // A confirmed stay whose journey never began is a stay nothing tracks: no
    // invitation, no arrival, nothing for the console to show — and it would
    // look exactly like a normal booking.
    expect(journey).toMatchObject({ precheckin: 'pending', arrival: 'pending' })

    const events = await db.execute(
      sql`select id from domain_events
           where entity_id = ${reservationId} and event_type = 'journey.start'`,
    )
    expect(events).toHaveLength(1)
  })

  it('emits an event for every transition', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    await applyJourneyCommand({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      command: { type: 'arrival.expect', time: '18:30' },
    })

    // The zero-touch metric (G1) is computed from these. A state reached
    // without an event is a state that never happened as far as the product
    // can tell.
    const events = await db.execute(
      sql`select id from domain_events
           where entity_id = ${reservationId} and event_type = 'arrival.expect'`,
    )
    expect(events).toHaveLength(1)

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey).toMatchObject({ arrival: 'expected', expectedArrivalTime: '18:30' })
  })

  it('writes no event when it refuses', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    const outcome = await applyJourneyCommand({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      command: { type: 'departure.settle' },
    })

    expect(outcome.status).toBe('refused')

    const events = await db.execute(
      sql`select id from domain_events
           where entity_id = ${reservationId} and event_type = 'departure.settle'`,
    )
    // A refused command did not happen. Logging it as an event would put a
    // transition in the history that the state never took.
    expect(events).toHaveLength(0)
  })

  it('will not apply a command across properties', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    const outcome = await applyJourneyCommand({
      propertyId: fixture.beta.propertyId,
      reservationId,
      command: { type: 'arrival.confirm' },
    })

    expect(outcome.status).toBe('unknown-reservation')

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.arrival).toBe('pending')
  })
})

describe('pre-arrival (E2.1)', () => {
  it('saves the party and marks pre-check-in submitted', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    const outcome = await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [
        { guestIndex: 0, surname: 'Weber', givenName: 'Rosa', citizenship: 'AT' },
        { guestIndex: 1, surname: 'Weber', givenName: 'Hans', citizenship: 'AT' },
      ],
    })

    expect(outcome).toEqual({ status: 'saved', submitted: true })

    const records = await db.execute(
      sql`select id from registration_records where reservation_id = ${reservationId}`,
    )
    expect(records).toHaveLength(2)

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.precheckin).toBe('submitted')
  })

  it('is resumable — resubmitting updates the same people', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: 'Wber', givenName: 'Rosa' }],
    })

    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: 'Weber', givenName: 'Rosa' }],
    })

    const records = await db.execute<{ data: { fullName: string; surname: string } }>(
      sql`select data from registration_records where reservation_id = ${reservationId}`,
    )

    // A party of one that becomes a party of two in the registry is a
    // compliance problem, not a cosmetic one.
    expect(records).toHaveLength(1)
    expect(records[0]?.data.fullName).toBe('Rosa Weber')
    expect(records[0]?.data.surname).toBe('Weber')
  })

  it('refuses a party with nobody in it', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    const outcome = await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: '   ', givenName: '  ' }],
    })

    expect(outcome.status).toBe('rejected')
  })

  it('attaches a document and moves the journey', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: 'Weber', givenName: 'Rosa' }],
    })

    const outcome = await recordDocument({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      guestIndex: 0,
      documentPath: `${fixture.alpha.propertyId}/${reservationId}/0`,
    })

    expect(outcome).toEqual({ status: 'recorded' })

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.documents).toBe('captured')
  })

  it('will not resurrect a document that was deleted under E2.4', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: 'Weber', givenName: 'Rosa' }],
    })

    await db.execute(
      sql`update registration_records set document_path = null, deleted_at = now()
           where reservation_id = ${reservationId} and guest_index = 0`,
    )

    const outcome = await recordDocument({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      guestIndex: 0,
      documentPath: 'somewhere/else',
    })

    // Accepting a new document here would quietly undo a deletion somebody is
    // entitled to rely on.
    expect(outcome.status).toBe('rejected')
  })

  it('records an arrival time (E2.2)', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    expect(
      await setExpectedArrival({
        propertyId: fixture.alpha.propertyId,
        reservationId,
        time: '21:45',
      }),
    ).toEqual({ status: 'set' })

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.expectedArrivalTime).toBe('21:45')
  })

  it('refuses a time that is not one', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    const outcome = await setExpectedArrival({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      time: 'evening',
    })

    expect(outcome.status).toBe('rejected')
  })
})

describe('the stay token is the whole boundary', () => {
  it('resolves to the stay it was signed for', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)
    const [row] = await db.execute<{ departure_date: string }>(
      sql`select departure_date::text from reservations where id = ${reservationId}`,
    )

    const token = signStayToken(reservationId, row!.departure_date)!
    const resolved = await resolveStay(token)

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    expect(resolved.stay.reservationId).toBe(reservationId)
    expect(resolved.stay.propertyId).toBe(fixture.alpha.propertyId)
    expect(resolved.stay.outstanding).toContain('details')
  })

  it('stops working the moment the booking is cancelled', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)
    const [row] = await db.execute<{ departure_date: string }>(
      sql`select departure_date::text from reservations where id = ${reservationId}`,
    )
    const token = signStayToken(reservationId, row!.departure_date)!

    await db.execute(sql`update reservations set status = 'cancelled' where id = ${reservationId}`)

    // This is what makes a stateless token safe: the reservation is re-read on
    // every request, so nothing has to be revoked.
    const resolved = await resolveStay(token)

    expect(resolved).toMatchObject({ ok: false, reason: 'unavailable' })
  })

  it('refuses a token for a reservation that does not exist', async () => {
    const token = signStayToken('11111111-2222-3333-4444-555555555555', '2026-12-01')!

    expect(await resolveStay(token)).toMatchObject({ ok: false, reason: 'unavailable' })
  })
})

describe('the T-48h invitation (E2.1)', () => {
  it('finds stays arriving inside the window', async () => {
    const soon = await confirmedStay(fixture.alpha.propertyId, 1)
    const later = await confirmedStay(fixture.alpha.propertyId, 30)

    const due = await listPrecheckinDue({ withinHours: 50, limit: 50 })
    const ids = due.map((row) => row.reservationId)

    expect(ids).toContain(soon)
    // Inviting a guest a month out is an email they will have forgotten by the
    // time it matters.
    expect(ids).not.toContain(later)
  })

  it('does not chase stays that already left', async () => {
    const past = await confirmedStay(fixture.alpha.propertyId, -30)

    const due = await listPrecheckinDue({ withinHours: 50, limit: 50 })

    // Without the lower bound every past stay is permanently due, and the sweep
    // spends its life re-inviting people who have gone home.
    expect(due.map((row) => row.reservationId)).not.toContain(past)
  })

  it('sends one invitation and queues one email', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 1)

    const outcome = await sendPrecheckinInvite({
      propertyId: fixture.alpha.propertyId,
      reservationId,
    })

    expect(outcome.status).toBe('invited')

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.precheckin).toBe('invited')

    const [notification] = await db.execute<{ template: string; payload: { checkinUrl: string } }>(
      sql`select template, payload from notifications
           where reservation_id = ${reservationId} and template = 'precheckin.invite'`,
    )
    expect(notification?.template).toBe('precheckin.invite')
    // The link carries the token and nothing else — a second identifier for the
    // same thing is one somebody would eventually trust instead of the signed one.
    expect(notification?.payload.checkinUrl).toContain('/stay/')
  })

  it('does not invite the same guest twice', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 1)

    await sendPrecheckinInvite({ propertyId: fixture.alpha.propertyId, reservationId })
    const second = await sendPrecheckinInvite({
      propertyId: fixture.alpha.propertyId,
      reservationId,
    })

    // The sweep runs hourly. The machine is what makes that safe: `invite` from
    // `invited` is a no-op, so one email goes out however often it runs.
    expect(second.status).toBe('skipped')

    const notifications = await db.execute(
      sql`select id from notifications
           where reservation_id = ${reservationId} and template = 'precheckin.invite'`,
    )
    expect(notifications).toHaveLength(1)
  })

  it('does not invite a guest who already finished', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 1)

    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: 'Weber', givenName: 'Rosa' }],
    })

    const outcome = await sendPrecheckinInvite({
      propertyId: fixture.alpha.propertyId,
      reservationId,
    })

    // A guest who followed the link in their confirmation email before the
    // sweep reached them. Emailing them to do what they have already done is
    // the sort of thing that makes people stop reading our messages.
    expect(outcome.status).toBe('skipped')
  })
})
