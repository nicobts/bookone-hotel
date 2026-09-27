import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { agentRuns, guests, journeyStates, properties, reservations, roomTypes } from '../db/schema'
import { outstandingForGuest, type JourneyState } from '../journey/machine'
import { paidCents } from '../payments/webhook'

/**
 * The facts the Guest Desk tools read (WP0.3).
 *
 * One read per concern, scoped by property and reservation explicitly — these
 * run under the service role for a guest who holds no session (ADR-007). The
 * tools turn them into phrases; nothing here is said to anyone directly.
 */
export interface StayFacts {
  reservationId: string
  propertySlug: string
  propertyLocale: string
  status: string
  arrivalDate: string
  departureDate: string
  adults: number
  children: number
  roomTypeCode: string | null
  roomNames: Record<string, string> | null
  totalCents: number
  currency: string
  paidCents: number
  hasGuestEmail: boolean
  outstanding: ('details' | 'documents' | 'arrival')[]
  expectedArrivalTime: string | null
}

export async function getStayFacts(
  propertyId: string,
  reservationId: string,
): Promise<StayFacts | null> {
  const [row] = await asService((db) =>
    db
      .select({
        reservationId: reservations.id,
        slug: properties.slug,
        locale: properties.localeDefault,
        status: reservations.status,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
        roomTypeCode: roomTypes.code,
        roomNames: roomTypes.nameI18n,
        totalCents: reservations.totalCents,
        currency: reservations.currency,
        guestEmail: guests.email,
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        arrival: journeyStates.arrival,
        departure: journeyStates.departure,
        alloggiati: journeyStates.alloggiati,
        expectedArrivalTime: journeyStates.expectedArrivalTime,
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

  const pax = (row.pax ?? {}) as Record<string, unknown>
  const state = {
    precheckin: row.precheckin ?? 'pending',
    documents: row.documents ?? 'pending',
    arrival: row.arrival ?? 'pending',
    departure: row.departure ?? 'pending',
    alloggiati: row.alloggiati ?? 'pending',
    expectedArrivalTime: row.expectedArrivalTime,
  } as JourneyState

  return {
    reservationId: row.reservationId,
    propertySlug: row.slug,
    propertyLocale: row.locale,
    status: row.status,
    arrivalDate: row.arrivalDate,
    departureDate: row.departureDate,
    adults: typeof pax.adults === 'number' ? pax.adults : 1,
    children: typeof pax.children === 'number' ? pax.children : 0,
    roomTypeCode: row.roomTypeCode,
    roomNames:
      row.roomNames !== null && typeof row.roomNames === 'object'
        ? (row.roomNames as Record<string, string>)
        : null,
    totalCents: row.totalCents ?? 0,
    currency: row.currency ?? 'EUR',
    paidCents: await paidCents(propertyId, reservationId),
    hasGuestEmail: Boolean(row.guestEmail?.trim()),
    outstanding: outstandingForGuest(state),
    expectedArrivalTime: row.expectedArrivalTime,
  }
}

/** The property's own slug, read by id — never taken from anything a guest or model wrote. */
export async function getPropertySlug(propertyId: string): Promise<string | null> {
  const [row] = await asService((db) =>
    db
      .select({ slug: properties.slug })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1),
  )
  return row?.slug ?? null
}

/** Arrivals on one date at one property, for the owner's read-only agent. */
export async function listArrivalsOn(
  propertyId: string,
  date: string,
): Promise<{ reservationId: string; reference: string | null; guestName: string | null }[]> {
  return asService((db) =>
    db
      .select({
        reservationId: reservations.id,
        reference: reservations.reference,
        guestName: guests.name,
      })
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.arrivalDate, date),
          eq(reservations.status, 'confirmed'),
        ),
      )
      .orderBy(asc(guests.name)),
  )
}

/**
 * Confirmed stays arriving between two dates whose guests have not finished
 * pre-arrival — "who has not sent their documents yet?".
 */
export async function listCaptureOutstanding(
  propertyId: string,
  from: string,
  to: string,
): Promise<
  { reservationId: string; guestName: string | null; arrivalDate: string; missing: string[] }[]
> {
  const rows = await asService((db) =>
    db
      .select({
        reservationId: reservations.id,
        guestName: guests.name,
        arrivalDate: reservations.arrivalDate,
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        arrival: journeyStates.arrival,
        departure: journeyStates.departure,
        alloggiati: journeyStates.alloggiati,
      })
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          gte(reservations.arrivalDate, from),
          lte(reservations.arrivalDate, to),
        ),
      )
      .orderBy(asc(reservations.arrivalDate)),
  )

  return rows
    .map((row) => ({
      reservationId: row.reservationId,
      guestName: row.guestName,
      arrivalDate: row.arrivalDate,
      missing: outstandingForGuest({
        precheckin: row.precheckin ?? 'pending',
        documents: row.documents ?? 'pending',
        arrival: row.arrival ?? 'pending',
        departure: row.departure ?? 'pending',
        alloggiati: row.alloggiati ?? 'pending',
        expectedArrivalTime: null,
      } as JourneyState).filter((item) => item !== 'arrival'),
    }))
    .filter((row) => row.missing.length > 0)
}

/**
 * The output of a completed call with this idempotency key, if there is one
 * (WP0.3: "no write executes twice for the same key").
 *
 * The key is thread + tool + input hash, recorded on the call itself in
 * `agent_runs.tool_calls`, so the ledger that proves a call happened is the
 * one that prevents it happening again.
 */
export async function findCompletedToolCall(
  propertyId: string,
  idempotencyKey: string,
  withinHours = 24,
): Promise<Record<string, unknown> | null> {
  const probe = JSON.stringify([{ idempotencyKey, status: 'done' }])

  const [row] = await asService((db) =>
    db
      .select({ toolCalls: agentRuns.toolCalls })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.propertyId, propertyId),
          sql`${agentRuns.toolCalls} @> ${probe}::jsonb`,
          sql`${agentRuns.at} > now() - make_interval(hours => ${withinHours})`,
        ),
      )
      .limit(1),
  )

  if (!row || !Array.isArray(row.toolCalls)) return null

  const call = (
    row.toolCalls as { idempotencyKey?: string; status?: string; output?: unknown }[]
  ).find((c) => c.idempotencyKey === idempotencyKey && c.status === 'done')

  return call && call.output !== null && typeof call.output === 'object'
    ? (call.output as Record<string, unknown>)
    : null
}
