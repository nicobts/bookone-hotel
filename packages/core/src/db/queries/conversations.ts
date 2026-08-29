import { and, asc, eq, sql } from 'drizzle-orm'
import { withUser } from '../session'
import { guests, journeyStates, messageThreads, messages, profiles, reservations } from '../schema'

/**
 * The staff side of a conversation (E3.3).
 *
 * Read through `withUser`, so what comes back is what the database says this
 * person may see (ADR-018) — the same discipline as every other console query,
 * and it matters more here than most: these rows are what a named guest said
 * about where they are sleeping tonight.
 *
 * ## The queue is ordered by who has waited longest
 *
 * Not by recency. A support inbox sorted newest-first buries the thread that has
 * been ignored for two hours under three that arrived in the last five minutes,
 * and the buried one is the only one that is actually going wrong. Unowned work
 * sorts above owned work for the same reason: a ten-room property has nobody
 * whose job is to notice that nobody picked something up.
 */

export interface ThreadSummary {
  id: string
  reservationId: string
  status: string
  locale: string
  guestName: string | null
  reference: string
  arrivalDate: string
  departureDate: string
  assignedTo: string | null
  assignedName: string | null
  escalationReason: string | null
  escalatedAt: Date | null
  lastGuestMessageAt: Date | null
  lastReplyAt: Date | null
  /** The guest's most recent words, for the queue row. Truncated in SQL. */
  preview: string | null
  messageCount: number
}

const summaryColumns = {
  id: messageThreads.id,
  reservationId: messageThreads.reservationId,
  status: messageThreads.status,
  locale: messageThreads.locale,
  guestName: guests.name,
  reference: sql<string>`coalesce(${reservations.reference}, '')`,
  arrivalDate: reservations.arrivalDate,
  departureDate: reservations.departureDate,
  assignedTo: messageThreads.assignedTo,
  assignedName: profiles.fullName,
  escalationReason: messageThreads.escalationReason,
  escalatedAt: messageThreads.escalatedAt,
  lastGuestMessageAt: messageThreads.lastGuestMessageAt,
  lastReplyAt: messageThreads.lastReplyAt,
  preview: sql<string | null>`(
    select left(m.body, 140)
    from messages m
    where m.thread_id = ${messageThreads.id} and m.author = 'guest'
    order by m.created_at desc
    limit 1
  )`,
  messageCount: sql<number>`(
    select count(*)::int from messages m where m.thread_id = ${messageThreads.id}
  )`,
}

/** Every open conversation, worst-waiting first. */
export async function listThreads(userId: string, propertyId: string): Promise<ThreadSummary[]> {
  return withUser(userId, (db) =>
    db
      .select(summaryColumns)
      .from(messageThreads)
      .innerJoin(reservations, eq(reservations.id, messageThreads.reservationId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(profiles, eq(profiles.userId, messageThreads.assignedTo))
      .where(
        and(eq(messageThreads.propertyId, propertyId), sql`${messageThreads.status} <> 'closed'`),
      )
      /*
       * Unowned escalations first, then anything else waiting on us, then the
       * quiet ones — and within each band, longest wait first.
       *
       * Written as a CASE rather than as three queries because the console
       * renders one list: an owner opening this at 07:00 wants to read down it
       * and stop when the rows stop mattering, not switch between tabs to find
       * out whether anything is on fire.
       */
      .orderBy(
        sql`case
              when ${messageThreads.status} = 'escalated' and ${messageThreads.assignedTo} is null then 0
              when ${messageThreads.status} = 'escalated' then 1
              when ${messageThreads.status} = 'awaiting_reply' then 2
              else 3
            end`,
        asc(
          sql`coalesce(${messageThreads.escalatedAt}, ${messageThreads.lastGuestMessageAt}, ${messageThreads.createdAt})`,
        ),
      ),
  )
}

export interface ThreadDetail extends ThreadSummary {
  /** The stay card E3.3 asks for: who, which dates, where the journey stands. */
  journey: {
    precheckin: string
    documents: string
    alloggiati: string
    arrival: string
    departure: string
    expectedArrivalTime: string | null
  }
  messages: {
    id: string
    author: string
    authorName: string | null
    body: string
    agentRunId: string | null
    createdAt: Date
  }[]
}

/**
 * One conversation, with everything the person answering needs beside it.
 *
 * E3.3's acceptance criterion is that the handoff carries the stay card and the
 * guest never repeats themselves. That is why the journey comes back in the
 * same call as the messages: a receptionist who has to open a second screen to
 * find out whether the guest has checked in will ask the guest instead.
 */
export async function getThread(
  userId: string,
  propertyId: string,
  threadId: string,
): Promise<ThreadDetail | null> {
  return withUser(userId, async (db) => {
    const [row] = await db
      .select({
        ...summaryColumns,
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        alloggiati: journeyStates.alloggiati,
        arrival: journeyStates.arrival,
        departure: journeyStates.departure,
        expectedArrivalTime: journeyStates.expectedArrivalTime,
      })
      .from(messageThreads)
      .innerJoin(reservations, eq(reservations.id, messageThreads.reservationId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(profiles, eq(profiles.userId, messageThreads.assignedTo))
      .leftJoin(journeyStates, eq(journeyStates.reservationId, messageThreads.reservationId))
      .where(and(eq(messageThreads.id, threadId), eq(messageThreads.propertyId, propertyId)))
      .limit(1)

    if (!row) return null

    const thread = await db
      .select({
        id: messages.id,
        author: messages.author,
        authorName: profiles.fullName,
        body: messages.body,
        agentRunId: messages.agentRunId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .leftJoin(profiles, eq(profiles.userId, messages.authorUserId))
      .where(and(eq(messages.threadId, threadId), eq(messages.propertyId, propertyId)))
      .orderBy(asc(messages.createdAt))

    const {
      precheckin,
      documents,
      alloggiati,
      arrival,
      departure,
      expectedArrivalTime,
      ...summary
    } = row

    return {
      ...summary,
      journey: {
        precheckin: precheckin ?? 'pending',
        documents: documents ?? 'pending',
        alloggiati: alloggiati ?? 'pending',
        arrival: arrival ?? 'pending',
        departure: departure ?? 'pending',
        expectedArrivalTime,
      },
      messages: thread,
    }
  })
}

/** How many conversations are waiting on a person. The console badge (E5.1). */
export async function countWaitingThreads(userId: string, propertyId: string): Promise<number> {
  const [row] = await withUser(userId, (db) =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.propertyId, propertyId),
          sql`${messageThreads.status} in ('escalated', 'awaiting_reply')`,
        ),
      ),
  )

  return row?.count ?? 0
}
