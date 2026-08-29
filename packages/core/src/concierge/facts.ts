import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { guests, journeyStates, properties, reservations, roomTypes } from '../db/schema'

/**
 * The facts a concierge tool is allowed to state, read from rows.
 *
 * This file exists because of a rule, and the rule earned it: **agents have no
 * database access, ever** (binding rule 5, ADR-011). AG-01's `get_reservation`
 * tool was first written with a Drizzle query inside it, in
 * `packages/agents`, and it did not compile — that package does not depend on
 * `drizzle-orm` and is not going to. The tool now calls this.
 *
 * That is worth recording rather than quietly fixing. The guarantee "an agent
 * cannot read what a tool does not hand it" is only as good as the thing
 * enforcing it, and here the enforcement was a missing dependency in a
 * package.json — cheap, unglamorous, and it worked on the first attempt to
 * cross the line.
 */

export interface ReservationFacts {
  reference: string
  arrivalDate: string
  departureDate: string
  status: string
  roomNames: Record<string, string> | null
  guestName: string | null
  /** The property's stated response window, when it has one. */
  businessHours: string | null
  arrival: string
  departure: string
}

/**
 * One stay, scoped by property.
 *
 * `asService` with an explicit property predicate, like every worker-side read
 * (ADR-007, binding rule 3). The reservation id reaching this function came
 * from the runner's context, never from anything an agent produced.
 */
export async function getReservationFacts(
  propertyId: string,
  reservationId: string,
): Promise<ReservationFacts | null> {
  const [row] = await asService((db) =>
    db
      .select({
        reference: reservations.reference,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        status: reservations.status,
        roomNames: roomTypes.nameI18n,
        guestName: guests.name,
        settings: properties.settings,
        arrival: journeyStates.arrival,
        departure: journeyStates.departure,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1),
  )

  if (!row) return null

  return {
    reference: row.reference ?? '',
    arrivalDate: row.arrivalDate,
    departureDate: row.departureDate,
    status: row.status,
    roomNames:
      typeof row.roomNames === 'object' && row.roomNames !== null
        ? (row.roomNames as Record<string, string>)
        : null,
    guestName: row.guestName,
    businessHours: readBusinessHours(row.settings),
    arrival: row.arrival ?? 'pending',
    departure: row.departure ?? 'pending',
  }
}

/**
 * When the property says it answers.
 *
 * Null when they have not said, and the escalation phrase then omits the
 * sentence entirely rather than inventing a plausible window. A guest told
 * "someone will reply within the hour" by software that has no idea is a guest
 * who has been lied to about a small thing at the moment they most needed a
 * true one.
 */
export function readBusinessHours(settings: unknown): string | null {
  if (typeof settings !== 'object' || settings === null) return null

  const value = (settings as Record<string, unknown>).businessHours

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** `{ it: "Doppia", en: "Double" }` with the guest → English → first chain. */
export function localisedName(names: Record<string, string> | null, locale: string): string | null {
  if (!names) return null

  const candidate = names[locale] ?? names.en ?? Object.values(names)[0]

  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}
