import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { PmsAdapter, PmsReservation } from '../../../adapters/pms'
import { closeConnection } from '../../client'
import { asService } from '../../session'
import { reflectReservation } from '../../../sync/reflect'
import { reconcileBookingDomain } from '../../../sync/reconcile'
import { refreshAvailability } from '../../../sync/availability'
import { reset, seed, type Fixture } from './support'

/**
 * The nightly parity pass and the availability cache, against a real database.
 *
 * A local fake rather than `MockEricsoftAdapter`, for the same reason as
 * `reflect.test.ts`: importing the concrete adapter would make `core` depend on
 * `adapters`, which depends on `core`.
 */

let fx: Fixture

beforeAll(async () => {
  fx = await seed()
}, 60_000)

afterAll(async () => {
  await reset()
  await closeConnection()
})

/** An adapter that returns whatever the test says the PMS holds. */
function fakeAdapter(theirs: Record<string, PmsReservation | null> = {}): PmsAdapter {
  let sequence = 0

  return {
    system: 'ericsoft',
    getAvailability: async (query) => ({
      entries: [
        {
          roomTypeCode: 'DBL',
          date: query.from,
          available: 3,
          priceCents: 12_000,
          currency: 'EUR',
        },
        // A code this property does not have. The refresh must skip it rather
        // than invent a room type.
        {
          roomTypeCode: 'SUITE',
          date: query.from,
          available: 1,
          priceCents: 40_000,
          currency: 'EUR',
        },
      ],
      fetchedAt: new Date('2026-09-01T08:00:00Z'),
    }),
    getReservation: async (_propertyId, externalId) => theirs[externalId] ?? null,
    reflectReservation: async () => {
      sequence += 1
      return { system: 'ericsoft', externalId: `ERI-${String(sequence).padStart(6, '0')}` }
    },
    postCheckIn: async () => undefined,
    healthCheck: async () => ({ healthy: true, checkedAt: new Date() }),
  }
}

/** Reflects alpha's reservation so there is something to reconcile. */
async function reflectAlpha(): Promise<string> {
  const outcome = await reflectReservation(
    { adapter: fakeAdapter() },
    { propertyId: fx.alpha.propertyId, reservationId: fx.alpha.reservationId },
  )

  if (outcome.status === 'not-applicable') throw new Error(outcome.reason)
  return outcome.externalId
}

describe('reconcileBookingDomain', () => {
  it('records perfect parity when the two sides agree', async () => {
    const externalId = await reflectAlpha()

    const result = await reconcileBookingDomain(
      {
        adapter: fakeAdapter({
          [externalId]: {
            externalId,
            roomTypeCode: 'DBL',
            arrivalDate: '2026-09-01',
            departureDate: '2026-09-04',
            guestName: 'hotel-alpha guest',
            status: 'confirmed',
          },
        }),
      },
      { propertyId: fx.alpha.propertyId },
    )

    expect(result?.comparedCount).toBe(1)
    expect(result?.discrepanciesCount).toBe(0)
    expect(result?.parityRatio).toBe(1)
  })

  it('records a discrepancy and the parity it costs', async () => {
    const externalId = await reflectAlpha()

    const result = await reconcileBookingDomain(
      {
        adapter: fakeAdapter({
          [externalId]: {
            externalId,
            // Somebody moved the guest in one system and not the other.
            roomTypeCode: 'SGL',
            arrivalDate: '2026-09-01',
            departureDate: '2026-09-04',
            guestName: 'hotel-alpha guest',
            status: 'confirmed',
          },
        }),
      },
      { propertyId: fx.alpha.propertyId },
    )

    expect(result?.discrepanciesCount).toBe(1)
    expect(result?.parityRatio).toBe(0)

    const rows = await asService((db) =>
      db.execute<{ class: string; ours: unknown; theirs: unknown }>(
        sql`select class, ours, theirs from discrepancies where run_id = ${result!.runId}`,
      ),
    )

    expect(rows[0]?.class).toBe('logic')
    // Both sides recorded, not a description of them. An explanation written
    // months later needs the values.
    expect(rows[0]?.ours).toMatchObject({ roomTypeCode: 'DBL' })
    expect(rows[0]?.theirs).toMatchObject({ roomTypeCode: 'SGL' })
  })

  it('flags a reservation the PMS has lost', async () => {
    const externalId = await reflectAlpha()

    // Reflected, then absent on their side. Never benign.
    const result = await reconcileBookingDomain(
      { adapter: fakeAdapter({ [externalId]: null }) },
      { propertyId: fx.alpha.propertyId },
    )

    expect(result?.discrepanciesCount).toBe(1)

    const rows = await asService((db) =>
      db.execute<{ class: string }>(
        sql`select class from discrepancies where run_id = ${result!.runId}`,
      ),
    )

    expect(rows[0]?.class).toBe('logic')
  })

  it('reports null parity rather than 100% when nothing was comparable', async () => {
    // beta has no reflected reservation, so nothing can be compared. A ratio
    // over zero entities is undefined, and calling it perfect parity is the
    // kind of number that gets quoted back in a board deck.
    const result = await reconcileBookingDomain(
      { adapter: fakeAdapter() },
      { propertyId: fx.beta.propertyId },
    )

    expect(result?.comparedCount).toBe(0)
    expect(result?.parityRatio).toBeNull()
  })

  it('emits a reconciliation-origin event', async () => {
    const result = await reconcileBookingDomain(
      { adapter: fakeAdapter() },
      { propertyId: fx.alpha.propertyId },
    )

    const events = await asService((db) =>
      db.execute<{ origin: string; actor: string }>(
        sql`select origin, actor from domain_events
             where event_type = 'reconciliation.completed'
               and payload ->> 'runId' = ${result!.runId}`,
      ),
    )

    // `reconciliation` is the third origin, and it exists so a row written by
    // the nightly pass is distinguishable from a platform write and a sync one.
    expect(events[0]?.origin).toBe('reconciliation')
    expect(events[0]?.actor).toBe('system')
  })

  it('does nothing where the PMS owns booking', async () => {
    await asService((db) =>
      db.execute(
        sql`update properties set authority_map = '{"booking":"pms"}'::jsonb
             where id = ${fx.beta.propertyId}`,
      ),
    )

    // Reconciliation compares two sources. Where we are not one of them there
    // is nothing to compare, and a run claiming 100% against ourselves would
    // be a reassuring number that means nothing.
    const result = await reconcileBookingDomain(
      { adapter: fakeAdapter() },
      { propertyId: fx.beta.propertyId },
    )

    expect(result).toBeNull()

    await asService((db) =>
      db.execute(
        sql`update properties set authority_map = '{}'::jsonb where id = ${fx.beta.propertyId}`,
      ),
    )
  })
})

describe('refreshAvailability', () => {
  it('writes a snapshot per night and skips unknown room types', async () => {
    // The seed gives each property DBL and SGL. The fake also offers SUITE,
    // which this property does not have — inventing it would put a room on the
    // booking surface the hotel cannot sell.
    const result = await refreshAvailability(
      { adapter: fakeAdapter() },
      { propertyId: fx.alpha.propertyId, from: '2026-09-10', to: '2026-09-11' },
    )

    expect(result.written).toBe(1)
    expect(result.skipped).toBe(1)

    const rows = await asService((db) =>
      db.execute<{ source: string; price_cents: number; date_from: string; date_to: string }>(
        sql`select source, price_cents, date_from, date_to from rate_snapshots
             where property_id = ${fx.alpha.propertyId}`,
      ),
    )

    expect(rows).toHaveLength(1)
    // Provenance is the point of this table: every displayed price traces back
    // to the fetch that produced it (PRD A2).
    expect(rows[0]?.source).toBe('ericsoft')
    // One night is [date, date+1) — `date_to` is exclusive everywhere.
    expect(rows[0]?.date_from).toBe('2026-09-10')
    expect(rows[0]?.date_to).toBe('2026-09-11')
  })

  it('replaces the window rather than accumulating', async () => {
    // Snapshots are a cache. A table that only grows would hold two prices for
    // one night and leave the surface choosing by insertion order.
    await refreshAvailability(
      { adapter: fakeAdapter() },
      { propertyId: fx.alpha.propertyId, from: '2026-09-10', to: '2026-09-11' },
    )
    await refreshAvailability(
      { adapter: fakeAdapter() },
      { propertyId: fx.alpha.propertyId, from: '2026-09-10', to: '2026-09-11' },
    )

    const rows = await asService((db) =>
      db.execute(sql`select 1 from rate_snapshots where property_id = ${fx.alpha.propertyId}`),
    )

    expect(rows).toHaveLength(1)
  })
})
