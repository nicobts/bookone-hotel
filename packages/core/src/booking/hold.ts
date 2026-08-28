import { and, eq, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { properties, reservations, roomTypes } from '../db/schema'
import { emit } from '../events'
import { guestActor, systemActor } from '../events/actor'
import { resolveAuthority } from '../authority'
import { hasSettledPayment } from '../payments/webhook'
import { generateReference } from './reference'
import { nightsBetween, quoteStay } from './quote'
import type { SnapshotNight } from './quote'

/**
 * The booking hold (E1.3, design note §4A).
 *
 * A **price** hold, not an inventory hold. It fixes the quoted total and the
 * snapshots it was computed from for thirty minutes; it reserves no room,
 * because in V1 the PMS owns inventory and we have nothing of our own to
 * decrement (ADR-001). Anyone reading `status = 'hold'` as a held room is
 * reading in an assumption this codebase does not make — the design note says
 * so, and so does the column comment.
 *
 * What the hold actually buys is honesty at step 4: the guest sees the same
 * total they saw at step 2, and if the cache moved underneath them in the
 * meantime, the price they were shown is still the price they get.
 */

/** E1.3: "booking held 30 min". */
export const HOLD_MINUTES = 30

export interface CreateHoldInput {
  propertyId: string
  roomTypeId: string
  arrival: string
  departure: string
  adults: number
  children: number
  /** The nights and their snapshot ids, exactly as the search returned them. */
  nights: SnapshotNight[]
  /** Attribution evidence, captured at creation and never backfilled (PRD §6). */
  engineSessionId?: string
  conciergeSessionId?: string
}

export type CreateHoldOutcome =
  | {
      status: 'held'
      reservationId: string
      reference: string
      totalCents: number
      currency: string
      expiresAt: Date
    }
  | { status: 'rejected'; reason: string }

export async function createHold(input: CreateHoldInput): Promise<CreateHoldOutcome> {
  const { propertyId, roomTypeId, arrival, departure, adults, children } = input

  if (nightsBetween(arrival, departure).length === 0) {
    return { status: 'rejected', reason: 'departure must follow arrival' }
  }

  // Re-priced here from the nights the caller passed, rather than trusting a
  // total sent from a browser. The quote arrives through a URL a guest can
  // edit, and a total taken on faith is a total anyone can set to zero.
  const quoted = quoteStay(arrival, departure, input.nights)
  if (!quoted.ok) {
    return { status: 'rejected', reason: `cannot price the stay: ${quoted.failure.reason}` }
  }

  return asService(async (db) => {
    const [property] = await db
      .select({ authorityMap: properties.authorityMap })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1)

    if (!property) return { status: 'rejected', reason: 'unknown property' }

    if (resolveAuthority(property.authorityMap, 'booking') !== 'platform') {
      // The PMS owns booking here. Writing a reservation would create a second
      // truth — the failure the dual-source design exists to prevent — and this
      // property should not have a booking surface enabled at all.
      return { status: 'rejected', reason: 'pms is authoritative for booking' }
    }

    // Scoped to the property. A room type id is a UUID a caller supplies, and
    // this is what stops one property's booking surface holding another's room.
    const [roomType] = await db
      .select({ id: roomTypes.id, capacity: roomTypes.capacity })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.propertyId, propertyId)))
      .limit(1)

    if (!roomType) return { status: 'rejected', reason: 'unknown room type' }

    if (roomType.capacity < adults + children) {
      return { status: 'rejected', reason: 'party does not fit the room type' }
    }

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000)

    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reservations)
        .values({
          propertyId,
          roomTypeId,
          status: 'hold',
          origin: 'platform',
          arrivalDate: arrival,
          departureDate: departure,
          pax: { adults, children },
          totalCents: quoted.quote.totalCents,
          currency: quoted.quote.currency,
          rateSnapshotIds: quoted.quote.snapshotIds,
          reference: generateReference(),
          holdExpiresAt: expiresAt,
          ...(input.engineSessionId ? { engineSessionId: input.engineSessionId } : {}),
          ...(input.conciergeSessionId ? { conciergeSessionId: input.conciergeSessionId } : {}),
        })
        .returning({ id: reservations.id, reference: reservations.reference })

      if (!row) throw new Error('reservations insert returned no row')

      await emit(tx, {
        propertyId,
        entityType: 'reservation',
        entityId: row.id,
        eventType: 'reservation.hold_created',
        origin: 'platform',
        // The guest acts, even though they hold no account (ADR-007). The
        // actor is the reservation itself, which is the only handle a guest has.
        actor: guestActor(row.id),
        payload: {
          roomTypeId,
          arrival,
          departure,
          pax: { adults, children },
          totalCents: quoted.quote.totalCents,
          currency: quoted.quote.currency,
          rateSnapshotIds: quoted.quote.snapshotIds,
          expiresAt: expiresAt.toISOString(),
        },
      })

      return {
        status: 'held' as const,
        reservationId: row.id,
        reference: row.reference ?? '',
        totalCents: quoted.quote.totalCents,
        currency: quoted.quote.currency,
        expiresAt,
      }
    })
  })
}

/**
 * Cancels holds whose thirty minutes ran out.
 *
 * Cancelled, not deleted: money and attribution evidence hang off a reservation
 * and the monthly report is the invoice (D14), so nothing in this table is ever
 * removed — the policy map says so and this job obeys it.
 *
 * Runs on a schedule across every property, which is legitimate for a
 * maintenance job (ADR-007) — but note the query still names the status and the
 * time, and nothing else, so the worst a bug here does is cancel a hold early.
 */
export async function expireHolds(now: Date = new Date()): Promise<{ expired: number }> {
  return asService(async (db) => {
    const stale = await db
      .select({ id: reservations.id, propertyId: reservations.propertyId })
      .from(reservations)
      .where(and(eq(reservations.status, 'hold'), lt(reservations.holdExpiresAt, now)))

    if (stale.length === 0) return { expired: 0 }

    return db.transaction(async (tx) => {
      let expired = 0

      for (const row of stale) {
        // A hold with money against it is not an abandoned hold. It is a
        // booking whose confirmation did not finish — the webhook was lost, or
        // the confirm failed after the capture — and cancelling it here would
        // take the room away from someone who has already paid for it, silently
        // and on a schedule. `replayLostPayments` is what resolves these.
        if (await hasSettledPayment(row.id)) continue

        const updated = await tx
          .update(reservations)
          .set({ status: 'cancelled' })
          // The status is re-checked in the update itself. Between the select
          // and here, a guest may have confirmed — and expiring a booking the
          // hotel has already been told about is the one outcome this job must
          // never produce.
          .where(and(eq(reservations.id, row.id), eq(reservations.status, 'hold')))
          .returning({ id: reservations.id })

        // Nothing updated means it stopped being a hold in the meantime. No
        // event: an expiry event for a confirmed booking would be a false entry
        // in the log every downstream reader has to learn to ignore.
        if (updated.length === 0) continue

        expired += 1

        await emit(tx, {
          propertyId: row.propertyId,
          entityType: 'reservation',
          entityId: row.id,
          eventType: 'reservation.hold_expired',
          origin: 'platform',
          actor: systemActor,
          payload: { expiredAt: now.toISOString() },
        })
      }

      return { expired }
    })
  })
}
