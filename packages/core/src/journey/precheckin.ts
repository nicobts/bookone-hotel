import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  guests,
  journeyStates,
  properties,
  registrationRecords,
  reservations,
  roomTypes,
} from '../db/schema'
import { emit } from '../events'
import { guestActor } from '../events/actor'
import { applyJourneyCommandIn } from './apply'
import { verifyStayToken } from './token'
import { outstandingForGuest, type JourneyState } from './machine'

/**
 * Pre-arrival (E2.1, E2.2).
 *
 * The guest-facing half of the journey. Everything here is reached with a
 * signed stay token and no session (ADR-007), so every function starts by
 * resolving that token to exactly one reservation and works only within it.
 *
 * ## Resumable is a requirement, not a nicety
 *
 * E2.1 asks for a five-minute median with document photos, on a phone, often on
 * hotel wifi. That flow *will* be interrupted. So every step writes
 * independently and idempotently: party details, then documents, then arrival
 * time, in whatever order the guest manages, with the form reading back what is
 * already there. Nothing is staged in a session that a dropped connection can
 * lose.
 */

export interface ResolvedStay {
  reservationId: string
  propertyId: string
  propertySlug: string
  propertyName: string
  propertyLocale: string
  propertySettings: unknown
  reference: string
  status: string
  arrivalDate: string
  departureDate: string
  adults: number
  children: number
  roomName: Record<string, string>
  roomCode: string | null
  leadGuestName: string | null
  leadGuestEmail: string | null
  leadGuestLocale: string | null
  journey: JourneyState
  party: PartyMember[]
  /** What the guest still has to do, from one definition (see the machine). */
  outstanding: ReturnType<typeof outstandingForGuest>
}

export interface PartyMember {
  guestIndex: number
  data: Record<string, unknown>
  hasDocument: boolean
  documentDeleted: boolean
}

export type ResolveFailure =
  | { reason: 'invalid-token' }
  | { reason: 'expired-token' }
  | { reason: 'not-configured' }
  /** The token verifies but the stay is gone or cancelled. */
  | { reason: 'unavailable'; status: string }

export type ResolveResult = { ok: true; stay: ResolvedStay } | ({ ok: false } & ResolveFailure)

/**
 * The stay behind a token.
 *
 * The reservation is re-read every time rather than trusted from the token.
 * That is what makes a stateless token safe: a cancelled booking stops working
 * the moment it is cancelled, without anyone having to revoke anything.
 */
export async function resolveStay(token: string, now: Date = new Date()): Promise<ResolveResult> {
  const verified = verifyStayToken(token, now)

  if (!verified.ok) {
    return {
      ok: false,
      reason:
        verified.reason === 'expired'
          ? 'expired-token'
          : verified.reason === 'not-configured'
            ? 'not-configured'
            : 'invalid-token',
    }
  }

  const { reservationId } = verified.payload

  return asService(async (db) => {
    const [row] = await db
      .select({
        reservationId: reservations.id,
        propertyId: reservations.propertyId,
        propertySlug: properties.slug,
        propertyName: properties.name,
        propertyLocale: properties.localeDefault,
        propertySettings: properties.settings,
        reference: reservations.reference,
        status: reservations.status,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
        roomName: roomTypes.nameI18n,
        roomCode: roomTypes.code,
        leadGuestName: guests.name,
        leadGuestEmail: guests.email,
        leadGuestLocale: guests.locale,
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        alloggiati: journeyStates.alloggiati,
        arrival: journeyStates.arrival,
        departure: journeyStates.departure,
        expectedArrivalTime: journeyStates.expectedArrivalTime,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(eq(reservations.id, reservationId))
      .limit(1)

    if (!row) return { ok: false, reason: 'unavailable', status: 'missing' }

    // Only a confirmed stay has a pre-arrival. A cancelled one is why the
    // re-read exists at all, and a hold has not been paid for yet.
    if (row.status !== 'confirmed') {
      return { ok: false, reason: 'unavailable', status: row.status }
    }

    // Null when the journey has not started — a stay confirmed before this
    // sprint existed. The surface starts it on first visit rather than showing
    // the guest an error about our own migration history.
    const journey: JourneyState = {
      precheckin: row.precheckin ?? 'pending',
      documents: row.documents ?? 'pending',
      alloggiati: row.alloggiati ?? 'pending',
      arrival: row.arrival ?? 'pending',
      departure: row.departure ?? 'pending',
      expectedArrivalTime: row.expectedArrivalTime ?? null,
    }

    const records = await db
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
          eq(registrationRecords.propertyId, row.propertyId),
        ),
      )
      .orderBy(asc(registrationRecords.guestIndex))

    const pax = readPax(row.pax)

    return {
      ok: true,
      stay: {
        reservationId: row.reservationId,
        propertyId: row.propertyId,
        propertySlug: row.propertySlug,
        propertyName: row.propertyName,
        propertyLocale: row.propertyLocale,
        propertySettings: row.propertySettings,
        reference: row.reference ?? '',
        status: row.status,
        arrivalDate: row.arrivalDate,
        departureDate: row.departureDate,
        adults: pax.adults,
        children: pax.children,
        roomName: readStringRecord(row.roomName),
        roomCode: row.roomCode,
        leadGuestName: row.leadGuestName,
        leadGuestEmail: row.leadGuestEmail,
        leadGuestLocale: row.leadGuestLocale,
        journey,
        party: records.map((record) => ({
          guestIndex: record.guestIndex,
          data: (record.data ?? {}) as Record<string, unknown>,
          hasDocument: Boolean(record.documentPath),
          documentDeleted: Boolean(record.deletedAt),
        })),
        outstanding: outstandingForGuest(journey),
      },
    }
  })
}

export interface PartyInput {
  guestIndex: number
  fullName: string
  birthDate?: string
  nationality?: string
  documentType?: string
  documentNumber?: string
}

export type SavePartyOutcome =
  { status: 'saved'; submitted: boolean } | { status: 'rejected'; reason: string }

/**
 * Records the party and marks pre-check-in submitted (E2.1).
 *
 * Upserts by `guest_index`, so a guest who reloads and posts again updates the
 * same people rather than registering them twice — which in a party of two
 * becoming four is a compliance problem, not a cosmetic one.
 *
 * The whole party and the journey transition commit together: a submitted
 * pre-check-in whose people did not save is a stay the console reports as ready
 * and the desk finds empty.
 */
export async function saveParty(input: {
  propertyId: string
  reservationId: string
  members: PartyInput[]
}): Promise<SavePartyOutcome> {
  const { propertyId, reservationId } = input

  const members = input.members.filter((member) => member.fullName.trim().length > 0)

  if (members.length === 0) {
    return { status: 'rejected', reason: 'at least one guest name is required' }
  }

  const indexes = new Set(members.map((member) => member.guestIndex))
  if (indexes.size !== members.length) {
    return { status: 'rejected', reason: 'duplicate guest index' }
  }

  return asService((db) =>
    db.transaction(async (tx) => {
      for (const member of members) {
        const data = {
          fullName: member.fullName.trim(),
          ...(member.birthDate ? { birthDate: member.birthDate } : {}),
          ...(member.nationality ? { nationality: member.nationality } : {}),
          ...(member.documentType ? { documentType: member.documentType } : {}),
          ...(member.documentNumber ? { documentNumber: member.documentNumber } : {}),
        }

        await tx
          .insert(registrationRecords)
          .values({
            propertyId,
            reservationId,
            guestIndex: member.guestIndex,
            data,
          })
          .onConflictDoUpdate({
            target: [registrationRecords.reservationId, registrationRecords.guestIndex],
            // Only the fields. The document path and the deletion stamp are set
            // by their own paths, and a resubmitted form must not resurrect a
            // document that E2.4 already destroyed.
            set: { data },
          })
      }

      const anyDocument = await tx
        .select({ id: registrationRecords.id })
        .from(registrationRecords)
        .where(
          and(
            eq(registrationRecords.reservationId, reservationId),
            eq(registrationRecords.propertyId, propertyId),
            sql`${registrationRecords.documentPath} is not null`,
          ),
        )
        .limit(1)

      const outcome = await applyJourneyCommandIn(tx, {
        propertyId,
        reservationId,
        command: { type: 'precheckin.submit', documentsCaptured: anyDocument.length > 0 },
        actor: guestActor(reservationId),
      })

      await emit(tx, {
        propertyId,
        entityType: 'reservation',
        entityId: reservationId,
        eventType: 'precheckin.party_saved',
        origin: 'platform',
        actor: guestActor(reservationId),
        // A count, not the people. The event log is read far more widely than
        // `registration_records`, whose policy was written for this data.
        payload: { partySize: members.length },
      })

      return {
        status: 'saved' as const,
        submitted: outcome.status === 'applied' || outcome.status === 'no-op',
      }
    }),
  )
}

export type DocumentOutcome = { status: 'recorded' } | { status: 'rejected'; reason: string }

/**
 * Attaches a captured document to one person (E2.1).
 *
 * Takes a storage path, not a file: the upload happens in the surface, against
 * EU Storage, and core stores where it went. Keeping the bytes out of the
 * domain layer is what lets the retention job (E2.4) delete an object without
 * this module knowing what a bucket is.
 */
export async function recordDocument(input: {
  propertyId: string
  reservationId: string
  guestIndex: number
  documentPath: string
}): Promise<DocumentOutcome> {
  const { propertyId, reservationId, guestIndex, documentPath } = input

  return asService((db) =>
    db.transaction(async (tx) => {
      const [record] = await tx
        .select({ id: registrationRecords.id, deletedAt: registrationRecords.deletedAt })
        .from(registrationRecords)
        .where(
          and(
            eq(registrationRecords.reservationId, reservationId),
            eq(registrationRecords.propertyId, propertyId),
            eq(registrationRecords.guestIndex, guestIndex),
          ),
        )
        .limit(1)

      if (!record) {
        return { status: 'rejected' as const, reason: 'no registration record for that guest' }
      }

      if (record.deletedAt) {
        // The document for this person was already destroyed under E2.4.
        // Accepting a new one would quietly undo a deletion somebody is
        // entitled to rely on.
        return { status: 'rejected' as const, reason: 'this document was deleted' }
      }

      await tx
        .update(registrationRecords)
        .set({ documentPath })
        .where(
          and(
            eq(registrationRecords.id, record.id),
            eq(registrationRecords.propertyId, propertyId),
          ),
        )

      await applyJourneyCommandIn(tx, {
        propertyId,
        reservationId,
        command: { type: 'documents.capture' },
        actor: guestActor(reservationId),
      })

      return { status: 'recorded' as const }
    }),
  )
}

/** The guest states when they will arrive (E2.2). */
export async function setExpectedArrival(input: {
  propertyId: string
  reservationId: string
  time: string
}): Promise<{ status: 'set' } | { status: 'rejected'; reason: string }> {
  const outcome = await asService((db) =>
    db.transaction((tx) =>
      applyJourneyCommandIn(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        command: { type: 'arrival.expect', time: input.time },
        actor: guestActor(input.reservationId),
      }),
    ),
  )

  if (outcome.status === 'applied' || outcome.status === 'no-op') return { status: 'set' }

  return {
    status: 'rejected',
    reason: outcome.status === 'refused' ? outcome.reason : 'unknown reservation',
  }
}

/**
 * Stays whose pre-arrival invitation is due (E2.1: T-48h).
 *
 * Returns confirmed reservations arriving inside the window whose journey has
 * not been invited yet. Deliberately also picks up stays whose journey row does
 * not exist — a booking confirmed before this sprint — and the job starts it.
 */
export async function listPrecheckinDue(input: {
  withinHours: number
  limit: number
  now?: Date
}): Promise<{ reservationId: string; propertyId: string }[]> {
  const now = input.now ?? new Date()
  const horizon = new Date(now.getTime() + input.withinHours * 3_600_000)

  return asService((db) =>
    db
      .select({
        reservationId: reservations.id,
        propertyId: reservations.propertyId,
      })
      .from(reservations)
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          // Arrivals from today up to the horizon. The lower bound matters:
          // without it every past stay in the database is permanently "due",
          // and the sweep spends its life re-inviting people who left.
          gte(reservations.arrivalDate, isoDate(now)),
          lte(reservations.arrivalDate, isoDate(horizon)),
          sql`(${journeyStates.precheckin} is null or ${journeyStates.precheckin} = 'pending')`,
          // No filter on `hold_expires_at`. A confirmed reservation keeps the
          // stamp from when it was a hold — it is history, not state — so
          // requiring it to be null excluded every booking the engine ever
          // made. `status = 'confirmed'` above is what rules out live holds,
          // and it is sufficient on its own.
        ),
      )
      .orderBy(asc(reservations.arrivalDate))
      .limit(input.limit),
  )
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
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
