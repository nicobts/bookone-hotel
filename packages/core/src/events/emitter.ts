import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { domainEvents } from '../db/schema'
import type * as schema from '../db/schema'
import type { EventOrigin } from '../types'
import { formatActor, type Actor } from './actor'

/**
 * The append-only event log (binding rule 2).
 *
 * Every mutation in the platform emits a row here carrying the actor and the
 * origin. Not for tidiness: this log is what makes the zero-touch metric (G1)
 * computable, the agent audit trail real, reconciliation able to explain
 * itself, and the attribution report defensible — and that report is the
 * invoice (D14).
 *
 * ## The transaction is the point
 *
 * `emit` takes the transaction handle rather than reaching for a connection of
 * its own. The event and the mutation it describes commit together or not at
 * all. Emitting afterwards, outside the transaction, produces a log that is
 * *mostly* right — which is worse than one that is obviously wrong, because
 * nobody knows which rows to distrust.
 *
 *   await withUser(userId, async (tx) => {
 *     const [reservation] = await tx.insert(reservations).values(...).returning()
 *     await emit(tx, {
 *       propertyId,
 *       entityType: 'reservation',
 *       entityId: reservation.id,
 *       eventType: 'reservation.confirmed',
 *       origin: 'platform',
 *       actor: userActor(userId),
 *     })
 *   })
 */

export interface EventInput {
  propertyId: string
  /** `reservation`, `guest`, `property`, … */
  entityType: string
  /** Our UUID for the thing. Absent for events about no particular row. */
  entityId?: string
  /** Dotted, past tense: `reservation.confirmed`, `documents.uploaded`. */
  eventType: string
  origin: EventOrigin
  actor: Actor
  payload?: Record<string, unknown>
}

type Tx = PostgresJsDatabase<typeof schema>

/**
 * Writes one event. Returns its id so a caller can link an `agent_runs` row to
 * the event that triggered it.
 */
export async function emit(tx: Tx, event: EventInput): Promise<bigint> {
  assertEventType(event.eventType)

  const [row] = await tx
    .insert(domainEvents)
    .values({
      propertyId: event.propertyId,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      eventType: event.eventType,
      origin: event.origin,
      actor: formatActor(event.actor),
      payload: event.payload ?? {},
    })
    .returning({ id: domainEvents.id })

  // The insert either returns a row or throws; this is here so the non-null
  // assertion is a stated expectation rather than a silent one.
  if (!row) throw new Error('domain_events insert returned no row')

  return row.id
}

/** Writes several events in one statement, in the caller's transaction. */
export async function emitMany(tx: Tx, events: EventInput[]): Promise<bigint[]> {
  if (events.length === 0) return []

  for (const event of events) assertEventType(event.eventType)

  const rows = await tx
    .insert(domainEvents)
    .values(
      events.map((event) => ({
        propertyId: event.propertyId,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        eventType: event.eventType,
        origin: event.origin,
        actor: formatActor(event.actor),
        payload: event.payload ?? {},
      })),
    )
    .returning({ id: domainEvents.id })

  return rows.map((row) => row.id)
}

/**
 * Event types are `noun.verb-in-past-tense`, lowercase.
 *
 * Checked at runtime rather than only in the type system because these strings
 * are the query surface for every report and every agent trigger. One
 * `reservation.Confirm` among ten thousand `reservation.confirmed` rows does
 * not fail anything — it quietly makes a count wrong, and the count is what
 * someone gets invoiced from.
 */
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/

function assertEventType(eventType: string): void {
  if (!EVENT_TYPE.test(eventType)) {
    throw new Error(
      `Invalid event type "${eventType}". Expected lowercase noun.verb-past, e.g. "reservation.confirmed".`,
    )
  }
}

export { EVENT_TYPE as EVENT_TYPE_PATTERN }
