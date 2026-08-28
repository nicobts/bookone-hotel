import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import { searchAvailability, AVAILABILITY_MAX_AGE_MS } from '../../../booking/search'
import { createHold, expireHolds } from '../../../booking/hold'
import { confirmBooking } from '../../../booking/confirm'
import { getBookingProperty, getHeldBooking } from '../../queries/booking'

/**
 * The booking surface, against a real database (E1.1, E1.2).
 *
 * Database-backed rather than mocked because every interesting behaviour here
 * *is* the database: what the snapshots contain, whether a hold is still a
 * hold, whether confirming twice produces two rows. A mocked version of this
 * file would assert that the code calls the functions it calls.
 *
 * The isolation assertions matter most. This surface runs under `asService` for
 * an anonymous visitor — there is no JWT for a policy to read — so the explicit
 * `property_id` on each query *is* the boundary (ADR-007). Nothing else is
 * checking it, which is why the cases below hand each function the other
 * property's ids and expect nothing back.
 */

let fixture: Fixture

/** Every night of the stay, priced, for one room type. */
async function priceNights(
  propertyId: string,
  roomTypeCode: string,
  dates: string[],
  options: { priceCents?: number; ageMs?: number } = {},
): Promise<void> {
  // ISO text with an explicit cast: a raw `sql` template passes a Date
  // through to the driver unserialised, which fails at bind time.
  const fetchedAt = new Date(Date.now() - (options.ageMs ?? 0)).toISOString()

  for (const date of dates) {
    await db.execute(sql`
      insert into rate_snapshots (property_id, room_type_id, date_from, date_to, price_cents,
                                  currency, source, fetched_at)
      values (
        ${propertyId},
        (select id from room_types where property_id = ${propertyId} and code = ${roomTypeCode}),
        ${date}, (${date}::date + 1), ${options.priceCents ?? 9000}, 'EUR', 'mock', ${fetchedAt}::timestamptz
      )`)
  }
}

async function clearSnapshots(): Promise<void> {
  await db.execute(sql`delete from rate_snapshots`)
}

const ARRIVAL = '2026-11-02'
const DEPARTURE = '2026-11-05'
const NIGHTS = ['2026-11-02', '2026-11-03', '2026-11-04']

beforeAll(async () => {
  fixture = await seed()
})

afterAll(async () => {
  await closeConnection()
})

describe('searchAvailability', () => {
  it('offers a room the cache priced for every night', async () => {
    await clearSnapshots()
    await priceNights(fixture.alpha.propertyId, 'DBL', NIGHTS)

    const outcome = await searchAvailability({
      propertyId: fixture.alpha.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return

    expect(outcome.options).toHaveLength(1)
    expect(outcome.options[0]?.code).toBe('DBL')
    expect(outcome.options[0]?.quote.totalCents).toBe(27_000)
    // Provenance, one id per night (PRD A2).
    expect(outcome.options[0]?.quote.snapshotIds).toHaveLength(3)
  })

  it('drops a room type with an unpriced night rather than quoting the rest', async () => {
    await clearSnapshots()
    // The middle night is missing. A partial quote would be cheaper than the
    // stay, and the guest would be entitled to the number we showed.
    await priceNights(fixture.alpha.propertyId, 'DBL', ['2026-11-02', '2026-11-04'])

    const outcome = await searchAvailability({
      propertyId: fixture.alpha.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    expect(outcome.status === 'ok' && outcome.options).toEqual([])
  })

  it('drops a room type the party does not fit', async () => {
    await clearSnapshots()
    await priceNights(fixture.alpha.propertyId, 'SGL', NIGHTS)

    const outcome = await searchAvailability({
      propertyId: fixture.alpha.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    // SGL sleeps one. Offering it would produce an arrival the hotel cannot
    // honour, which costs more than the booking is worth.
    expect(outcome.status === 'ok' && outcome.options).toEqual([])
  })

  it('falls back to the request form when the cache is stale', async () => {
    await clearSnapshots()
    await priceNights(fixture.alpha.propertyId, 'DBL', NIGHTS, {
      ageMs: AVAILABILITY_MAX_AGE_MS + 60_000,
    })

    const outcome = await searchAvailability({
      propertyId: fixture.alpha.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    // Not an empty list — that reads as "no rooms", which is a lie with the
    // same outcome as a wrong price (design note §4C).
    expect(outcome.status).toBe('stale')
  })

  it('lets the oldest row decide freshness, not the newest', async () => {
    await clearSnapshots()
    // A half-succeeded refresh: two fresh nights next to one stale one. Taking
    // the newest would let the fresh half vouch for the stale half.
    await priceNights(fixture.alpha.propertyId, 'DBL', ['2026-11-02', '2026-11-03'])
    await priceNights(fixture.alpha.propertyId, 'DBL', ['2026-11-04'], {
      ageMs: AVAILABILITY_MAX_AGE_MS + 60_000,
    })

    const outcome = await searchAvailability({
      propertyId: fixture.alpha.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    expect(outcome.status).toBe('stale')
  })

  it('treats a property with no snapshots as stale, not as sold out', async () => {
    await clearSnapshots()

    const outcome = await searchAvailability({
      propertyId: fixture.beta.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    expect(outcome).toEqual({ status: 'stale', fetchedAt: null })
  })

  it('never sees another property’s snapshots', async () => {
    await clearSnapshots()
    await priceNights(fixture.alpha.propertyId, 'DBL', NIGHTS)

    // Beta has none of its own. If the query were unscoped it would find
    // alpha's — the surface runs as the service role, so nothing else stops it.
    const outcome = await searchAvailability({
      propertyId: fixture.beta.propertyId,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
    })

    expect(outcome.status).toBe('stale')
  })
})

describe('createHold', () => {
  const nights = NIGHTS.map((date) => ({
    date,
    priceCents: 9000,
    currency: 'EUR',
    snapshotId: `snap-${date}`,
  }))

  async function alphaRoomType(code: string): Promise<string> {
    const [row] = await db.execute<{ id: string }>(
      sql`select id from room_types
          where property_id = ${fixture.alpha.propertyId} and code = ${code}`,
    )

    return row!.id
  }

  it('writes a hold with an expiry, a reference and its provenance', async () => {
    const outcome = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: await alphaRoomType('DBL'),
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
      nights,
    })

    expect(outcome.status).toBe('held')
    if (outcome.status !== 'held') return

    expect(outcome.totalCents).toBe(27_000)
    expect(outcome.reference).toMatch(/^BO-/)
    expect(outcome.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const [row] = await db.execute<{ status: string; rate_snapshot_ids: string[] }>(
      sql`select status, rate_snapshot_ids from reservations where id = ${outcome.reservationId}`,
    )

    expect(row?.status).toBe('hold')
    expect(row?.rate_snapshot_ids).toHaveLength(3)

    const [event] = await db.execute<{ event_type: string; actor: string }>(
      sql`select event_type, actor from domain_events
          where entity_id = ${outcome.reservationId} and event_type = 'reservation.hold_created'`,
    )

    // The guest acts, even holding no account (ADR-007).
    expect(event?.actor).toBe(`guest:${outcome.reservationId}`)
  })

  it('refuses another property’s room type', async () => {
    const [betaRoom] = await db.execute<{ id: string }>(
      sql`select id from room_types where property_id = ${fixture.beta.propertyId} and code = 'DBL'`,
    )

    // The room type id comes out of a form. This is the check that stops one
    // property's booking surface holding another's room.
    const outcome = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: betaRoom!.id,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
      nights,
    })

    expect(outcome).toEqual({ status: 'rejected', reason: 'unknown room type' })
  })

  it('refuses a party that does not fit', async () => {
    const outcome = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: await alphaRoomType('SGL'),
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 1,
      nights,
    })

    expect(outcome.status).toBe('rejected')
  })

  it('prices from the nights it is given, not from a posted total', async () => {
    const outcome = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: await alphaRoomType('DBL'),
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
      // One night short of the stay. There is no total to accept, so the only
      // possible answer is a refusal.
      nights: nights.slice(0, 2),
    })

    expect(outcome.status).toBe('rejected')
  })
})

describe('confirmBooking', () => {
  async function freshHold(): Promise<string> {
    const [room] = await db.execute<{ id: string }>(
      sql`select id from room_types
          where property_id = ${fixture.alpha.propertyId} and code = 'DBL'`,
    )

    const outcome = await createHold({
      propertyId: fixture.alpha.propertyId,
      roomTypeId: room!.id,
      arrival: ARRIVAL,
      departure: DEPARTURE,
      adults: 2,
      children: 0,
      nights: NIGHTS.map((date) => ({
        date,
        priceCents: 9000,
        currency: 'EUR',
        snapshotId: `snap-${date}`,
      })),
    })

    if (outcome.status !== 'held') throw new Error('fixture hold failed')

    return outcome.reservationId
  }

  const guest = { name: 'Rosa Weber', email: 'Rosa.Weber@example.test', locale: 'de' }

  it('confirms, records the guest, and queues the confirmation in one commit', async () => {
    const reservationId = await freshHold()

    const outcome = await confirmBooking({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      guest,
    })

    expect(outcome.status).toBe('confirmed')
    if (outcome.status !== 'confirmed') return

    const [reservation] = await db.execute<{ status: string; guest_id: string }>(
      sql`select status, guest_id from reservations where id = ${reservationId}`,
    )
    expect(reservation?.status).toBe('confirmed')
    expect(reservation?.guest_id).toBeTruthy()

    const [guestRow] = await db.execute<{ email: string; marketing_consent: boolean }>(
      sql`select email, marketing_consent from guests where id = ${reservation!.guest_id}`,
    )
    // Lowercased on the way in, so the same person booking twice is one row.
    expect(guestRow?.email).toBe('rosa.weber@example.test')
    // Never defaulted true. A consent that defaults on is not a consent.
    expect(guestRow?.marketing_consent).toBe(false)

    const [notification] = await db.execute<{ status: string; recipient: string }>(
      sql`select status, recipient from notifications where reservation_id = ${reservationId}`,
    )
    expect(notification?.status).toBe('queued')
    expect(notification?.recipient).toBe('rosa.weber@example.test')

    const events = await db.execute<{ event_type: string }>(
      sql`select event_type from domain_events
          where entity_id = ${reservationId} and event_type = 'reservation.confirmed'`,
    )
    expect(events).toHaveLength(1)
  })

  it('is idempotent — a second confirmation does not mail the guest twice', async () => {
    const reservationId = await freshHold()

    await confirmBooking({ propertyId: fixture.alpha.propertyId, reservationId, guest })
    const second = await confirmBooking({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      guest,
    })

    expect(second.status).toBe('already-confirmed')

    const notifications = await db.execute(
      sql`select id from notifications where reservation_id = ${reservationId}`,
    )
    // The unique constraint is what makes the retry path safe. Four taps on a
    // slow button must not produce four confirmation emails.
    expect(notifications).toHaveLength(1)

    const events = await db.execute(
      sql`select id from domain_events
          where entity_id = ${reservationId} and event_type = 'reservation.confirmed'`,
    )
    expect(events).toHaveLength(1)
  })

  it('refuses a hold whose thirty minutes ran out', async () => {
    const reservationId = await freshHold()
    await db.execute(
      sql`update reservations set hold_expires_at = now() - interval '1 minute'
          where id = ${reservationId}`,
    )

    const outcome = await confirmBooking({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      guest,
    })

    // Checked here rather than trusting the expiry job to have run: a guest
    // confirming in the gap would otherwise get a price the hold no longer
    // covered.
    expect(outcome.status).toBe('expired')
  })

  it('refuses to confirm another property’s hold', async () => {
    const reservationId = await freshHold()

    const outcome = await confirmBooking({
      propertyId: fixture.beta.propertyId,
      reservationId,
      guest,
    })

    expect(outcome).toEqual({ status: 'rejected', reason: 'unknown reservation' })

    const [row] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${reservationId}`,
    )
    expect(row?.status).toBe('hold')
  })

  it.each([
    ['an empty name', { ...guest, name: '  ' }],
    ['an address that is not one', { ...guest, email: 'rosa.weber' }],
  ])('refuses %s', async (_label, badGuest) => {
    const reservationId = await freshHold()

    const outcome = await confirmBooking({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      guest: badGuest,
    })

    expect(outcome.status).toBe('rejected')
  })
})

describe('expireHolds', () => {
  it('cancels what is past its expiry and touches nothing else', async () => {
    await db.execute(sql`delete from reservations where status = 'hold'`)

    const [room] = await db.execute<{ id: string }>(
      sql`select id from room_types
          where property_id = ${fixture.alpha.propertyId} and code = 'DBL'`,
    )

    const [stale] = await db.execute<{ id: string }>(
      sql`insert into reservations (property_id, room_type_id, status, arrival_date,
                                    departure_date, hold_expires_at)
          values (${fixture.alpha.propertyId}, ${room!.id}, 'hold', ${ARRIVAL}, ${DEPARTURE},
                  now() - interval '1 minute')
          returning id`,
    )

    const [live] = await db.execute<{ id: string }>(
      sql`insert into reservations (property_id, room_type_id, status, arrival_date,
                                    departure_date, hold_expires_at)
          values (${fixture.alpha.propertyId}, ${room!.id}, 'hold', ${ARRIVAL}, ${DEPARTURE},
                  now() + interval '20 minutes')
          returning id`,
    )

    const { expired } = await expireHolds()

    expect(expired).toBe(1)

    const [staleRow] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${stale!.id}`,
    )
    const [liveRow] = await db.execute<{ status: string }>(
      sql`select status from reservations where id = ${live!.id}`,
    )

    // Cancelled, never deleted: attribution and money evidence hang off this
    // table and the monthly report is the invoice (D14).
    expect(staleRow?.status).toBe('cancelled')
    expect(liveRow?.status).toBe('hold')

    const events = await db.execute(
      sql`select id from domain_events
          where entity_id = ${stale!.id} and event_type = 'reservation.hold_expired'`,
    )
    expect(events).toHaveLength(1)
  })
})

describe('getBookingProperty', () => {
  it('resolves a slug to the property behind it', async () => {
    const property = await getBookingProperty('hotel-alpha')

    expect(property?.id).toBe(fixture.alpha.propertyId)
  })

  it('returns nothing for an unknown slug', async () => {
    expect(await getBookingProperty('no-such-hotel')).toBeNull()
  })

  it('returns nothing when the pms owns booking at that property', async () => {
    await db.execute(
      sql`update properties set authority_map = '{"booking":"pms"}'::jsonb
          where id = ${fixture.beta.propertyId}`,
    )

    // There is no engine to offer. Rendering one would take a booking we are
    // not authoritative for, which is the failure the dual-source design exists
    // to prevent.
    expect(await getBookingProperty('hotel-beta')).toBeNull()

    await db.execute(
      sql`update properties set authority_map = '{}'::jsonb where id = ${fixture.beta.propertyId}`,
    )
  })
})

describe('getHeldBooking', () => {
  it('will not return a reservation belonging to another property', async () => {
    const found = await getHeldBooking(fixture.beta.propertyId, fixture.alpha.reservationId)

    expect(found).toBeNull()
  })
})
