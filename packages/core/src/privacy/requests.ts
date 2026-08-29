import { and, desc, eq, sql } from 'drizzle-orm'
import { guests, privacyRequests } from '../db/schema'
import { asService } from '../db/session'
import { emit } from '../events/emitter'
import { userActor, type Actor } from '../events/actor'

/**
 * Data-subject requests as tracked rows (E8.1).
 *
 * Art. 12(3) gives one month to respond. A deadline held in somebody's memory
 * is met until the month they are on holiday, and the penalty attaches to the
 * miss rather than to the intent — so the deadline is a column, the overdue
 * count is a query, and "we answered in time" is evidence instead of a
 * recollection.
 */

export type PrivacyRequestKind = 'export' | 'erasure'
export type PrivacyRequestStatus = 'open' | 'completed' | 'refused'

/** Art. 12(3): one month. Thirty days is the conservative reading of it. */
export const RESPONSE_DAYS = 30

export interface RaiseInput {
  propertyId: string
  guestId: string
  kind: PrivacyRequestKind
  /** The owner recording the request. */
  requestedBy: string
}

export interface PrivacyRequestRow {
  id: string
  guestId: string
  guestName: string | null
  kind: PrivacyRequestKind
  status: PrivacyRequestStatus
  dueBy: Date
  completedAt: Date | null
  outcome: unknown
  createdAt: Date
}

/**
 * Opens a request.
 *
 * `due_by` is computed by the database in the same statement as `created_at`,
 * so both come from one clock. Computing it in the application would produce a
 * deadline a few hundred milliseconds before the row it belongs to — which the
 * `privacy_requests_due_after_created` check would let through and nobody would
 * ever notice, right up until a period is measured against it.
 */
export async function raiseRequest(input: RaiseInput): Promise<string> {
  const { propertyId, guestId, kind, requestedBy } = input

  const [guest] = await asService((db) =>
    db
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.propertyId, propertyId))),
  )

  if (!guest) throw new Error('No such guest at this property')

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(privacyRequests)
        .values({
          propertyId,
          guestId,
          kind,
          requestedBy,
          dueBy: sql`now() + ${sql.raw(`interval '${RESPONSE_DAYS} days'`)}`,
        })
        .returning({ id: privacyRequests.id })

      if (!row) throw new Error('privacy_requests insert returned no row')

      await emit(tx, {
        propertyId,
        entityType: 'privacy_request',
        entityId: row.id,
        eventType: `privacy_request.${kind === 'export' ? 'export' : 'erasure'}_requested`,
        origin: 'platform',
        actor: userActor(requestedBy),
        // The guest id and nothing else. This event outlives the erasure it
        // may be about, so it must be safe to keep after it.
        payload: { guestId, kind },
      })

      return row.id
    }),
  )
}

export interface ResolveInput {
  propertyId: string
  requestId: string
  status: Exclude<PrivacyRequestStatus, 'open'>
  /** Counts, rule names and carve-outs. Never rows — see the schema comment. */
  outcome: Record<string, unknown>
  actor: Actor
}

/**
 * Closes a request, once.
 *
 * `where status = 'open'` rather than a read-then-write: two owners pressing at
 * the same moment must produce one completion, and the second must be able to
 * tell that it did nothing. An erasure applied twice is harmless; an erasure
 * *reported* twice makes the completion count wrong on the one report that is
 * meant to prove a deadline was met.
 */
export async function resolveRequest(input: ResolveInput): Promise<boolean> {
  const { propertyId, requestId, status, outcome } = input

  return asService((db) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .update(privacyRequests)
        .set({ status, outcome, completedAt: sql`now()` })
        .where(
          and(
            eq(privacyRequests.id, requestId),
            eq(privacyRequests.propertyId, propertyId),
            eq(privacyRequests.status, 'open'),
          ),
        )
        .returning({ id: privacyRequests.id, kind: privacyRequests.kind })

      const row = rows[0]
      if (!row) return false

      await emit(tx, {
        propertyId,
        entityType: 'privacy_request',
        entityId: row.id,
        eventType: status === 'completed' ? 'privacy_request.completed' : 'privacy_request.refused',
        origin: 'platform',
        actor: input.actor,
        payload: { kind: row.kind, outcome },
      })

      return true
    }),
  )
}

/** Every request for one property, newest first. Open ones sort to the top. */
export async function listRequests(propertyId: string): Promise<PrivacyRequestRow[]> {
  const rows = await asService((db) =>
    db
      .select({
        id: privacyRequests.id,
        guestId: privacyRequests.guestId,
        guestName: guests.name,
        kind: privacyRequests.kind,
        status: privacyRequests.status,
        dueBy: privacyRequests.dueBy,
        completedAt: privacyRequests.completedAt,
        outcome: privacyRequests.outcome,
        createdAt: privacyRequests.createdAt,
      })
      .from(privacyRequests)
      .innerJoin(guests, eq(guests.id, privacyRequests.guestId))
      .where(eq(privacyRequests.propertyId, propertyId))
      .orderBy(
        // Open first, then by deadline: the list is a work queue, and the row
        // closest to its deadline is the one that matters.
        sql`case when ${privacyRequests.status} = 'open' then 0 else 1 end`,
        privacyRequests.dueBy,
        desc(privacyRequests.createdAt),
      ),
  )

  return rows as PrivacyRequestRow[]
}

/** Open requests past their deadline. The number the console shows in red. */
export async function overdueCount(propertyId: string): Promise<number> {
  const rows = (await asService((db) =>
    db.execute(sql`
      select count(*)::int as n from privacy_requests
      where property_id = ${propertyId} and status = 'open' and due_by < now()
    `),
  )) as unknown as { n: number }[]

  return Number(rows[0]?.n ?? 0)
}
