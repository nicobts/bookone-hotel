import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs, properties, reservations, roomTypes } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { resolveAuthority } from '../authority'
import { PmsAdapterError, type PmsAdapter } from '../adapters/pms'

/**
 * Write-through of a platform-authored reservation to the PMS (PRD A3).
 *
 * The reservation is born here with our own UUID and `origin='platform'`
 * (D12, ADR-001); this is the step that tells the hotel's PMS it exists. It is
 * a *reflection*, not a handoff — we remain authoritative, and if the PMS never
 * accepts it the booking is still real.
 *
 * Runs in the worker under `asService`, because a sync job legitimately spans
 * properties. Every query below still scopes by `property_id` explicitly:
 * service-role is not permission to write an unscoped query (binding rule 3).
 */

export type ReflectOutcome =
  /** Reflected just now; `external_refs` written. */
  | { status: 'reflected'; externalId: string }
  /** Already reflected. The job ran twice; nothing to do. */
  | { status: 'already-reflected'; externalId: string }
  /** The PMS is authoritative here, so there is nothing to reflect. */
  | { status: 'not-applicable'; reason: string }

export interface ReflectDeps {
  adapter: PmsAdapter
}

export async function reflectReservation(
  deps: ReflectDeps,
  input: { propertyId: string; reservationId: string },
): Promise<ReflectOutcome> {
  const { adapter } = deps
  const { propertyId, reservationId } = input

  return asService(async (db) => {
    // Re-read rather than trust a payload captured at enqueue time. The job may
    // run minutes later, after a cancellation, and reflecting a stale copy
    // would push a booking the hotel no longer has.
    const [row] = await db
      .select({
        reservationId: reservations.id,
        status: reservations.status,
        origin: reservations.origin,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        totalCents: reservations.totalCents,
        currency: reservations.currency,
        roomTypeCode: roomTypes.code,
        authorityMap: properties.authorityMap,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) {
      // Not retryable and not an error worth paging anyone about: the
      // reservation was deleted, or the job outlived its subject.
      return { status: 'not-applicable', reason: 'reservation not found' }
    }

    if (resolveAuthority(row.authorityMap, 'booking') !== 'platform') {
      // The PMS owns booking at this property. Writing through would create a
      // second truth, which is the failure the dual-source design exists to
      // prevent — so this is a no-op, not a fallback.
      return { status: 'not-applicable', reason: 'pms is authoritative for booking' }
    }

    if (row.origin !== 'platform') {
      // It came *from* the PMS. Reflecting it back would echo their own
      // booking at them.
      return { status: 'not-applicable', reason: 'reservation originated in the pms' }
    }

    if (row.status !== 'confirmed') {
      // A 30-minute hold is not a booking yet, and a cancellation should not be
      // pushed as a new one.
      return { status: 'not-applicable', reason: `status is ${row.status}` }
    }

    // Second line of defence on idempotency. The adapter guarantees it too, but
    // this avoids the network call entirely — and covers an adapter that has
    // lost its own memory, which a restarted real connector has.
    const [existing] = await db
      .select({ externalId: externalRefs.externalId })
      .from(externalRefs)
      .where(
        and(
          eq(externalRefs.propertyId, propertyId),
          eq(externalRefs.system, adapter.system),
          eq(externalRefs.entityType, 'reservation'),
          eq(externalRefs.entityId, reservationId),
        ),
      )
      .limit(1)

    if (existing) {
      return { status: 'already-reflected', externalId: existing.externalId }
    }

    try {
      const reference = await adapter.reflectReservation({
        reservationId,
        propertyId,
        roomTypeCode: row.roomTypeCode ?? 'DBL',
        arrivalDate: row.arrivalDate,
        departureDate: row.departureDate,
        guestName: 'Guest',
        ...(row.totalCents !== null ? { totalCents: row.totalCents } : {}),
        currency: row.currency,
      })

      // The reference and its event commit together. A ref written without the
      // event leaves the log claiming the reflection never happened; an event
      // without the ref makes the next run reflect a second time.
      await db.transaction(async (tx) => {
        await tx.insert(externalRefs).values({
          propertyId,
          system: reference.system,
          entityType: 'reservation',
          entityId: reservationId,
          externalId: reference.externalId,
          lastSyncedAt: new Date(),
        })

        await emit(tx, {
          propertyId,
          entityType: 'reservation',
          entityId: reservationId,
          eventType: 'reservation.reflected',
          origin: 'sync',
          actor: systemActor,
          payload: { system: reference.system, externalId: reference.externalId },
        })
      })

      return { status: 'reflected', externalId: reference.externalId }
    } catch (error) {
      const failure = error instanceof PmsAdapterError ? error : null

      // The failure is recorded before it is rethrown, so the exceptions inbox
      // can say *why* rather than only that something is missing. An owner
      // asked to resolve "not reflected" with no reason cannot act on it.
      await asService((inner) =>
        inner.transaction((tx) =>
          emit(tx, {
            propertyId,
            entityType: 'reservation',
            entityId: reservationId,
            eventType: 'reservation.reflection-failed',
            origin: 'sync',
            actor: systemActor,
            payload: {
              code: failure?.code ?? 'unknown',
              retryable: failure?.retryable ?? false,
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        ),
      )

      // Rethrown so the queue applies its retry policy. Swallowing it here
      // would mark the job complete and the reservation would stay unreflected
      // forever, with a log entry nobody is watching.
      throw error
    }
  })
}
