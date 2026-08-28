import { and, asc, eq, gt, lte, sql } from 'drizzle-orm'
import { withUser } from '../session'
import { guests, journeyStates, reservations, roomTypes } from '../schema'

/**
 * Today — the shape of the day (PRD C2).
 *
 * Read through `withUser`, so what comes back is what the database says this
 * person may see (ADR-018), not what a filter in this file remembered to apply.
 *
 * ## What "today" means here
 *
 * The property's own calendar day, passed in by the caller, because the console
 * runs in a browser somewhere and the hotel's day is the one that matters.
 * Arrival and departure are calendar dates (03 §2), so this is plain date
 * comparison and no timezone arithmetic — which is exactly why they are stored
 * that way.
 */

export interface ArrivalRow {
  reservationId: string
  reference: string
  guestName: string | null
  roomCode: string | null
  roomNameI18n: Record<string, string>
  adults: number
  children: number
  /** Null until the guest tells us (E2.2). */
  expectedArrivalTime: string | null
  precheckin: string
  documents: string
  arrival: string
  /** True when nothing is left for the guest to do before they get here. */
  ready: boolean
}

export interface TodayView {
  arrivals: ArrivalRow[]
  departures: number
  inHouse: number
  /**
   * Arrivals whose guest has not finished pre-arrival.
   *
   * The number the owner actually acts on: everything else on this screen is
   * information, and this is a list of people to chase.
   */
  awaitingGuest: number
}

export async function getToday(
  userId: string,
  propertyId: string,
  today: string,
): Promise<TodayView> {
  return withUser(userId, async (db) => {
    const arrivals = await db
      .select({
        reservationId: reservations.id,
        reference: reservations.reference,
        guestName: guests.name,
        roomCode: roomTypes.code,
        roomNameI18n: roomTypes.nameI18n,
        pax: reservations.pax,
        expectedArrivalTime: journeyStates.expectedArrivalTime,
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        arrival: journeyStates.arrival,
      })
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          eq(reservations.arrivalDate, today),
        ),
      )
      // By the time the guest said they would arrive, earliest first, and the
      // ones who have not said yet at the end. That is the order a desk works
      // in, and `nulls last` is what keeps the unknowns from leading it.
      .orderBy(sql`${journeyStates.expectedArrivalTime} asc nulls last`, asc(reservations.id))

    const [departures] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          eq(reservations.departureDate, today),
        ),
      )

    const [inHouse] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          // Arrived on or before today and leaving after it. Departure is
          // exclusive everywhere in this codebase, and a guest checking out
          // this morning is not in house tonight.
          lte(reservations.arrivalDate, today),
          gt(reservations.departureDate, today),
        ),
      )

    const rows: ArrivalRow[] = arrivals.map((row) => {
      const pax = readPax(row.pax)
      const precheckin = row.precheckin ?? 'pending'
      const documents = row.documents ?? 'pending'

      return {
        reservationId: row.reservationId,
        reference: row.reference ?? '',
        guestName: row.guestName,
        roomCode: row.roomCode,
        roomNameI18n: readStringRecord(row.roomNameI18n),
        adults: pax.adults,
        children: pax.children,
        expectedArrivalTime: row.expectedArrivalTime,
        precheckin,
        documents,
        arrival: row.arrival ?? 'pending',
        ready: precheckin === 'submitted' && documents !== 'pending',
      }
    })

    return {
      arrivals: rows,
      departures: departures?.count ?? 0,
      inHouse: inHouse?.count ?? 0,
      awaitingGuest: rows.filter((row) => !row.ready).length,
    }
  })
}

function readPax(value: unknown): { adults: number; children: number } {
  if (value === null || typeof value !== 'object') return { adults: 1, children: 0 }

  const record = value as Record<string, unknown>

  return {
    adults: typeof record.adults === 'number' ? record.adults : 1,
    children: typeof record.children === 'number' ? record.children : 0,
  }
}

function readStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}
