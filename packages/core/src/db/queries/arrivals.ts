import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { withUser } from '../session'
import {
  alloggiatiSubmissions,
  guests,
  journeyStates,
  registrationRecords,
  reservations,
} from '../schema'

/**
 * What the desk needs to see about one arrival (E2.3, E3.1).
 *
 * Read through `withUser`, so what comes back is what the database says this
 * person may see (ADR-018).
 *
 * This is the screen where a receptionist confirms somebody has arrived and,
 * if the filing did not go automatically, sends it themselves. So it carries
 * three things: who is in the party, whether the filing succeeded, and — when
 * it did not — exactly what is missing.
 */

export interface ArrivalDetail {
  reservationId: string
  reference: string
  guestName: string | null
  arrivalDate: string
  departureDate: string
  expectedArrivalTime: string | null
  precheckin: string
  documents: string
  alloggiati: string
  arrival: string
  party: {
    guestIndex: number
    surname: string
    givenName: string
    hasDocument: boolean
    documentDeleted: boolean
    /** Registration fields present, for the "what is missing" list. */
    data: Record<string, unknown>
  }[]
  submission: {
    status: string
    channel: string
    guestCount: number
    payloadChecksum: string
    lastError: string | null
    submittedAt: Date | null
    acknowledgedAt: Date | null
    hasReceipt: boolean
  } | null
}

export async function getArrival(
  userId: string,
  propertyId: string,
  reservationId: string,
): Promise<ArrivalDetail | null> {
  return withUser(userId, async (db) => {
    const [row] = await db
      .select({
        reservationId: reservations.id,
        reference: reservations.reference,
        guestName: guests.name,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        expectedArrivalTime: journeyStates.expectedArrivalTime,
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        alloggiati: journeyStates.alloggiati,
        arrival: journeyStates.arrival,
      })
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return null

    const party = await db
      .select({
        guestIndex: registrationRecords.guestIndex,
        data: registrationRecords.data,
        documentPath: registrationRecords.documentPath,
        deletedAt: registrationRecords.deletedAt,
      })
      .from(registrationRecords)
      .where(
        and(
          eq(registrationRecords.reservationId, reservationId),
          eq(registrationRecords.propertyId, propertyId),
        ),
      )
      .orderBy(asc(registrationRecords.guestIndex))

    const [submission] = await db
      .select({
        status: alloggiatiSubmissions.status,
        channel: alloggiatiSubmissions.channel,
        guestCount: alloggiatiSubmissions.guestCount,
        payloadChecksum: alloggiatiSubmissions.payloadChecksum,
        lastError: alloggiatiSubmissions.lastError,
        submittedAt: alloggiatiSubmissions.submittedAt,
        acknowledgedAt: alloggiatiSubmissions.acknowledgedAt,
        // The receipt itself is not selected. The console shows *that* one
        // exists; reading it is a support action, and this query runs on a
        // screen a receptionist has open all day.
        hasReceipt: sql<boolean>`${alloggiatiSubmissions.receipt} is not null`,
      })
      .from(alloggiatiSubmissions)
      .where(
        and(
          eq(alloggiatiSubmissions.reservationId, reservationId),
          eq(alloggiatiSubmissions.propertyId, propertyId),
        ),
      )
      .limit(1)

    return {
      reservationId: row.reservationId,
      reference: row.reference ?? '',
      guestName: row.guestName,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      expectedArrivalTime: row.expectedArrivalTime,
      precheckin: row.precheckin ?? 'pending',
      documents: row.documents ?? 'pending',
      alloggiati: row.alloggiati ?? 'pending',
      arrival: row.arrival ?? 'pending',
      party: party.map((member) => {
        const data = (member.data ?? {}) as Record<string, unknown>

        return {
          guestIndex: member.guestIndex,
          surname: typeof data.surname === 'string' ? data.surname : '',
          givenName: typeof data.givenName === 'string' ? data.givenName : '',
          hasDocument: Boolean(member.documentPath),
          documentDeleted: Boolean(member.deletedAt),
          data,
        }
      }),
      submission: submission ?? null,
    }
  })
}

/**
 * Stays whose filing is overdue, for the exceptions inbox (E2.3: T-20h).
 *
 * Read through `withUser` like the rest of the inbox, so an owner sees their
 * own and nobody else's.
 */
export async function listOverdueAlloggiati(
  userId: string,
  propertyId: string,
  input: { hoursAfterArrival: number; now?: Date },
): Promise<{ reservationId: string; reference: string; arrivalDate: string; state: string }[]> {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - input.hoursAfterArrival * 3_600_000)
    .toISOString()
    .slice(0, 10)

  return withUser(userId, (db) =>
    db
      .select({
        reservationId: reservations.id,
        reference: sql<string>`coalesce(${reservations.reference}, '')`,
        arrivalDate: reservations.arrivalDate,
        state: journeyStates.alloggiati,
      })
      .from(reservations)
      .innerJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          // Arrived, and long enough ago to be overdue. A guest still in
          // transit is not late, and listing them would train an owner to
          // ignore this section.
          eq(journeyStates.arrival, 'confirmed'),
          sql`${reservations.arrivalDate} <= ${cutoff}`,
          sql`${journeyStates.alloggiati} <> 'acknowledged'`,
        ),
      )
      .orderBy(asc(reservations.arrivalDate)),
  )
}

/** Stays still holding documents after acknowledgement — the E2.4 backstop. */
export async function countUndeletedDocuments(userId: string, propertyId: string): Promise<number> {
  return withUser(userId, async (db) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(registrationRecords)
      .innerJoin(
        alloggiatiSubmissions,
        eq(alloggiatiSubmissions.reservationId, registrationRecords.reservationId),
      )
      .where(
        and(
          eq(registrationRecords.propertyId, propertyId),
          eq(alloggiatiSubmissions.status, 'acknowledged'),
          isNotNull(registrationRecords.documentPath),
        ),
      )

    return row?.count ?? 0
  })
}
