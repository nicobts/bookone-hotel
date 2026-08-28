import { and, desc, eq, inArray, isNull, lt, notExists, sql } from 'drizzle-orm'
import { withUser } from '../session'
import { discrepancies, domainEvents, externalRefs, reservations } from '../schema'
import { listOverdueAlloggiati } from './arrivals'

/**
 * The exceptions inbox (PRD C1, D15).
 *
 * The console's home screen and the reason it exists: only what needs a person.
 * Everything else has already handled itself, and an inbox that also lists the
 * things that worked is a dashboard, which is what D15 says this is not.
 *
 * Read through `withUser`, so the database decides which property's exceptions
 * come back (ADR-018).
 */

export type ExceptionKind = 'unreflected-reservation' | 'discrepancy' | 'alloggiati-overdue'

export interface ExceptionItem {
  id: string
  kind: ExceptionKind
  /** What the row is about — a reservation id, an entity ref. */
  subject: string
  /** Machine-readable reason, for choosing the resolution action. */
  code: string
  /** Human detail, already resolved from whatever recorded the failure. */
  detail: string | null
  occurredAt: Date
  /** True when a retry could plausibly fix it without a decision. */
  retryable: boolean
}

/**
 * How long a reservation may go unreflected before it is an exception.
 *
 * PRD A3 says unreflected reservations are visible in the console within 60
 * seconds. Below that they are simply in flight — surfacing them immediately
 * would fill the inbox with rows that resolve themselves before anyone looks,
 * and an inbox that cries wolf gets ignored, which costs more than the delay.
 */
export const UNREFLECTED_AFTER_SECONDS = 60

/**
 * When a registry filing counts as overdue (E2.3).
 *
 * The obligation is 24 hours from arrival. Twenty leaves four hours to act — an
 * alert that fires after the deadline is a notification of a breach rather than
 * a chance to avoid one, and this inbox exists to be actionable (D15).
 */
export const ALLOGGIATI_OVERDUE_HOURS = 20

interface FailureDetail {
  code: string
  message: string | null
  retryable: boolean
}

/**
 * Reservations we authored that the PMS has not acknowledged.
 *
 * Derived rather than stored: "unreflected" is the absence of an `external_refs`
 * row, and a status column duplicating that would be a second truth to keep in
 * step. The failure *reason* comes from the last
 * `reservation.reflection-failed` event, which is why that event is emitted
 * before the error is rethrown.
 *
 * Two queries rather than one with correlated subqueries in the select list.
 * The single-query version is harder to read, and Drizzle renders a column
 * reference inside such a subquery unqualified — which is either an ambiguous
 * column or a silently wrong correlation, depending on the table.
 */
export async function listUnreflectedReservations(
  userId: string,
  propertyId: string,
): Promise<ExceptionItem[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: reservations.id, createdAt: reservations.createdAt })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.origin, 'platform'),
          eq(reservations.status, 'confirmed'),
          lt(
            reservations.createdAt,
            sql`now() - ${sql.raw(`interval '${UNREFLECTED_AFTER_SECONDS} seconds'`)}`,
          ),
          // No reference from any system. `notExists` rather than a left join
          // and a null check: the latter multiplies rows when a reservation
          // carries references from two systems, which it will once Stripe
          // references land alongside the PMS ones.
          notExists(
            tx
              .select({ one: sql`1` })
              .from(externalRefs)
              .where(
                and(
                  eq(externalRefs.entityType, 'reservation'),
                  eq(externalRefs.entityId, reservations.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(reservations.createdAt))
      .limit(200),
  )

  if (rows.length === 0) return []

  const failures = await latestFailures(
    userId,
    rows.map((row) => row.id),
  )

  return rows.map((row) => {
    const failure = failures.get(row.id)

    return {
      id: `unreflected:${row.id}`,
      kind: 'unreflected-reservation' as const,
      subject: row.id,
      // No recorded failure means it never got as far as one — a queue that
      // never ran, most likely — so a retry is exactly the right action.
      code: failure?.code ?? 'pending',
      detail: failure?.message ?? null,
      occurredAt: row.createdAt,
      retryable: failure?.retryable ?? true,
    }
  })
}

/**
 * The most recent reflection failure per reservation.
 *
 * Ordered ascending and written into a map, so the last write wins and the map
 * ends up holding the newest. Cheaper than a window function and, more to the
 * point, obvious to the next reader.
 */
async function latestFailures(
  userId: string,
  reservationIds: string[],
): Promise<Map<string, FailureDetail>> {
  const events = await withUser(userId, (tx) =>
    tx
      .select({
        entityId: domainEvents.entityId,
        payload: domainEvents.payload,
        at: domainEvents.at,
      })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.eventType, 'reservation.reflection-failed'),
          inArray(domainEvents.entityId, reservationIds),
        ),
      )
      .orderBy(domainEvents.at),
  )

  const latest = new Map<string, FailureDetail>()

  for (const event of events) {
    if (!event.entityId) continue

    const payload = (event.payload ?? {}) as Record<string, unknown>

    latest.set(event.entityId, {
      code: typeof payload.code === 'string' ? payload.code : 'unknown',
      message: typeof payload.message === 'string' ? payload.message : null,
      retryable: payload.retryable === true,
    })
  }

  return latest
}

/** Discrepancies nobody has explained yet (03 §4). */
export async function listOpenDiscrepancies(
  userId: string,
  propertyId: string,
): Promise<ExceptionItem[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: discrepancies.id,
        entityRef: discrepancies.entityRef,
        class: discrepancies.class,
        createdAt: discrepancies.createdAt,
      })
      .from(discrepancies)
      .where(
        and(
          eq(discrepancies.propertyId, propertyId),
          isNull(discrepancies.resolvedAt),
          inArray(discrepancies.status, ['open', 'blocking']),
        ),
      )
      .orderBy(desc(discrepancies.createdAt))
      .limit(200),
  )

  return rows.map((row) => ({
    id: `discrepancy:${row.id}`,
    kind: 'discrepancy' as const,
    subject: row.entityRef,
    code: row.class,
    detail: null,
    occurredAt: row.createdAt,
    // A discrepancy is a disagreement between two systems. Retrying the
    // comparison would produce the same disagreement; it needs a decision.
    retryable: false,
  }))
}

/** Everything needing a person at this property, newest first. */
export async function listExceptions(userId: string, propertyId: string): Promise<ExceptionItem[]> {
  const [unreflected, open, overdue] = await Promise.all([
    listUnreflectedReservations(userId, propertyId),
    listOpenDiscrepancies(userId, propertyId),
    listOverdueFilings(userId, propertyId),
  ])

  return [...unreflected, ...open, ...overdue].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  )
}

/**
 * Registry filings that are late (E2.3, PRD C1).
 *
 * The obligation is the property's and the deadline is 24 hours from arrival,
 * so this is the one exception class where the cost of ignoring it is a fine
 * rather than an annoyed guest. It is retryable — pressing the action files
 * again — because the common causes are a channel that was down and a party
 * that was incomplete when the guest arrived.
 */
async function listOverdueFilings(userId: string, propertyId: string): Promise<ExceptionItem[]> {
  const rows = await listOverdueAlloggiati(userId, propertyId, {
    hoursAfterArrival: ALLOGGIATI_OVERDUE_HOURS,
  })

  return rows.map((row) => ({
    id: `alloggiati:${row.reservationId}`,
    kind: 'alloggiati-overdue' as const,
    subject: row.reservationId,
    code: row.state,
    detail: row.reference || null,
    // The arrival day, because that is what the deadline runs from and what an
    // owner sorts by when several are late.
    occurredAt: new Date(`${row.arrivalDate}T00:00:00Z`),
    retryable: true,
  }))
}
