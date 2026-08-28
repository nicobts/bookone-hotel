import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import type { ExternalReference, PmsAdapter, ReflectInput } from '../../../adapters/pms'
import { PmsAdapterError } from '../../../adapters/pms'
import { closeConnection, db } from '../../client'
import { asService } from '../../session'
import { reflectReservation } from '../../../sync/reflect'
import { listExceptions, UNREFLECTED_AFTER_SECONDS } from '../../queries/exceptions'
import { reset, seed, type Fixture } from './support'

/**
 * The Sprint 2 definition of done, as a test.
 *
 *   "reservation created in core reflects to mock ≤60s; injected failure
 *    appears in exceptions inbox with resolution action"
 *
 * Database-backed, so it lives with the isolation suites rather than in the
 * unit tests: the thing under test is the interaction between the write router,
 * the adapter, `external_refs` and the event log, and a mocked database would
 * assert that the mocks were called rather than that the engine works.
 *
 * The adapter here is a local fake rather than `MockEricsoftAdapter`. Importing
 * the concrete adapter would make `core` depend on `adapters`, which depends on
 * `core` — a cycle, and one that inverts the direction the ports-and-adapters
 * split exists to enforce. The domain is testable without knowing any
 * implementation exists; that is the property being preserved, not a
 * workaround. Turbo refused the cycle, which was the right answer.
 */

/** The narrowest thing that satisfies the port. */
function fakeAdapter(options: { failWith?: PmsAdapterError } = {}): PmsAdapter {
  let sequence = 0
  const issued = new Map<string, ExternalReference>()

  return {
    system: 'ericsoft',
    getAvailability: async () => ({ entries: [], fetchedAt: new Date() }),
    getReservation: async () => null,
    reflectReservation: async (input: ReflectInput) => {
      if (options.failWith) throw options.failWith

      const existing = issued.get(input.reservationId)
      if (existing) return existing

      sequence += 1
      const reference = {
        system: 'ericsoft',
        externalId: `ERI-${String(sequence).padStart(6, '0')}`,
      }
      issued.set(input.reservationId, reference)
      return reference
    },
    postCheckIn: async () => undefined,
    healthCheck: async () => ({ healthy: true, checkedAt: new Date() }),
  }
}

let fx: Fixture

beforeAll(async () => {
  fx = await seed()
}, 60_000)

afterAll(async () => {
  await reset()
  await closeConnection()
})

/** Backdates a reservation past the grace period, without waiting 60 seconds. */
async function backdate(reservationId: string): Promise<void> {
  await asService((database) =>
    database.execute(
      sql`update reservations
             set created_at = now() - ${sql.raw(`interval '${UNREFLECTED_AFTER_SECONDS + 30} seconds'`)}
           where id = ${reservationId}`,
    ),
  )
}

describe('reflecting a platform reservation', () => {
  it('writes an external_ref and emits the event', async () => {
    const adapter = fakeAdapter()

    const outcome = await reflectReservation(
      { adapter },
      { propertyId: fx.alpha.propertyId, reservationId: fx.alpha.reservationId },
    )

    expect(outcome.status).toBe('reflected')

    const refs = await asService((database) =>
      database.execute<{ external_id: string; system: string }>(
        sql`select external_id, system from external_refs
             where entity_id = ${fx.alpha.reservationId}`,
      ),
    )

    expect(refs).toHaveLength(1)
    expect(refs[0]?.system).toBe('ericsoft')

    const events = await asService((database) =>
      database.execute<{ event_type: string; origin: string; actor: string }>(
        sql`select event_type, origin, actor from domain_events
             where entity_id = ${fx.alpha.reservationId}
               and event_type = 'reservation.reflected'`,
      ),
    )

    // Binding rule 2: the reflection is a mutation, so it left a trace with an
    // actor and an origin. `sync` is what distinguishes it from a platform
    // write in every downstream report.
    expect(events).toHaveLength(1)
    expect(events[0]?.origin).toBe('sync')
    expect(events[0]?.actor).toBe('system')
  })

  it('is a no-op the second time', async () => {
    const adapter = fakeAdapter()

    const outcome = await reflectReservation(
      { adapter },
      { propertyId: fx.alpha.propertyId, reservationId: fx.alpha.reservationId },
    )

    // The job retries, and the exceptions inbox offers a manual retry on top.
    // Neither may produce a second booking in the hotel's PMS.
    expect(outcome.status).toBe('already-reflected')

    const refs = await asService((database) =>
      database.execute(
        sql`select 1 from external_refs where entity_id = ${fx.alpha.reservationId}`,
      ),
    )

    expect(refs).toHaveLength(1)
  })

  it('does nothing when the PMS is authoritative for booking', async () => {
    // Writing through under PMS authority would create a second truth, which
    // is the failure the dual-source design exists to prevent (ADR-001).
    await asService((database) =>
      database.execute(
        sql`update properties set authority_map = '{"booking":"pms"}'::jsonb
             where id = ${fx.beta.propertyId}`,
      ),
    )

    const outcome = await reflectReservation(
      { adapter: fakeAdapter() },
      { propertyId: fx.beta.propertyId, reservationId: fx.beta.reservationId },
    )

    expect(outcome).toEqual({
      status: 'not-applicable',
      reason: 'pms is authoritative for booking',
    })

    await asService((database) =>
      database.execute(
        sql`update properties set authority_map = '{}'::jsonb where id = ${fx.beta.propertyId}`,
      ),
    )
  })
})

describe('a failed reflection reaches the exceptions inbox', () => {
  it('records why it failed, and offers a retry', async () => {
    const adapter = fakeAdapter({
      failWith: new PmsAdapterError(
        'unavailable',
        'Injected unavailable on reflectReservation',
        true,
      ),
    })

    await expect(
      reflectReservation(
        { adapter },
        { propertyId: fx.beta.propertyId, reservationId: fx.beta.reservationId },
      ),
    ).rejects.toThrow()

    // Past the grace period, so it is an exception rather than in flight.
    await backdate(fx.beta.reservationId)

    const exceptions = await listExceptions(fx.beta.user.id, fx.beta.propertyId)
    const unreflected = exceptions.find((item) => item.kind === 'unreflected-reservation')

    expect(unreflected).toBeDefined()
    expect(unreflected?.subject).toBe(fx.beta.reservationId)
    // The reason, not just the absence. An owner asked to resolve "not
    // reflected" with no explanation cannot act on it.
    expect(unreflected?.code).toBe('unavailable')
    expect(unreflected?.detail).toContain('Injected')
    // `unavailable` is transport, so the one-tap action is a retry.
    expect(unreflected?.retryable).toBe(true)
  })

  it('leaves the inbox once the retry succeeds', async () => {
    await reflectReservation(
      { adapter: fakeAdapter() },
      { propertyId: fx.beta.propertyId, reservationId: fx.beta.reservationId },
    )

    const exceptions = await listExceptions(fx.beta.user.id, fx.beta.propertyId)

    expect(exceptions.filter((item) => item.kind === 'unreflected-reservation')).toEqual([])
  })

  it('does not surface a reservation still inside the grace period', async () => {
    // Below 60 seconds it is in flight, not an exception. An inbox that lists
    // rows which resolve themselves before anyone looks gets ignored, and an
    // ignored inbox costs more than the delay (PRD A3).
    const [fresh] = await asService((database) =>
      database.execute<{ id: string }>(
        sql`insert into reservations (property_id, arrival_date, departure_date, status, origin)
            values (${fx.alpha.propertyId}, '2026-10-01', '2026-10-03', 'confirmed', 'platform')
            returning id`,
      ),
    )

    const exceptions = await listExceptions(fx.alpha.user.id, fx.alpha.propertyId)

    expect(exceptions.map((item) => item.subject)).not.toContain(fresh!.id)
  })
})

describe('the exceptions inbox is property-scoped', () => {
  it('never shows another property’s discrepancies', async () => {
    const alpha = await listExceptions(fx.alpha.user.id, fx.alpha.propertyId)

    // The seed gives each property one open discrepancy. Alpha must see its
    // own and nothing of beta's — the query runs through withUser, so this is
    // the policy answering, not a where clause.
    const subjects = alpha.map((item) => item.subject)
    expect(subjects).not.toContain(`reservation:${fx.beta.reservationId}`)
    expect(alpha.some((item) => item.kind === 'discrepancy')).toBe(true)
  })

  it('returns nothing for a property the caller is not a member of', async () => {
    const rows = await listExceptions(fx.alpha.user.id, fx.beta.propertyId)

    expect(rows).toEqual([])
  })
})

describe('the raw connection still sees everything', () => {
  it('confirms these queries are scoped by policy, not by luck', async () => {
    // The control that makes the assertions above mean something: unscoped,
    // both properties' discrepancies are visible. So when withUser returns one,
    // that is RLS doing it.
    const rows = await db.execute(sql`select id from discrepancies`)

    expect(rows.length).toBe(2)
  })
})
