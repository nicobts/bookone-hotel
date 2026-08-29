import { and, asc, desc, eq, isNull, lt, or } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { asService } from '../db/session'
import { messageThreads, messages, reservations, stayTasks } from '../db/schema'
import type * as schema from '../db/schema'
import { emit } from '../events'
import { agentActor, guestActor, systemActor, userActor, type Actor } from '../events/actor'

/**
 * The conversation between a guest and a property (E3.2, E3.3).
 *
 * Every write to `messages` and `message_threads` from a domain path goes
 * through here, for the same reason `applyJourneyCommand` is the only writer of
 * `journey_states`: a thread's status is derived from what was said and by
 * whom, and a module that appended a message without moving the status would
 * leave a guest waiting in a queue nobody is watching.
 *
 * ## The status is a promise about who owes a reply
 *
 * Not a workflow stage. `awaiting_reply` means the guest is waiting on us;
 * `escalated` means they are waiting on a *person*; `answered` means they are
 * not waiting. The SLA sweep and the console queue both read it that way, and
 * it is why appending a guest message always reopens a thread — a guest who
 * writes again after "answered" is waiting again, whatever the previous
 * exchange concluded.
 */

type Tx = PostgresJsDatabase<typeof schema>

export interface ThreadRow {
  id: string
  propertyId: string
  reservationId: string
  status: 'open' | 'awaiting_reply' | 'escalated' | 'answered' | 'closed'
  locale: string
  assignedTo: string | null
  escalationReason: string | null
  lastGuestMessageAt: Date | null
  lastReplyAt: Date | null
  escalatedAt: Date | null
}

export interface MessageRow {
  id: string
  author: 'guest' | 'agent' | 'staff' | 'system'
  authorUserId: string | null
  body: string
  agentRunId: string | null
  createdAt: Date
}

/** The longest message a guest may send in one go. */
export const MAX_MESSAGE_LENGTH = 4_000

export class MessageRejected extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'MessageRejected'
  }
}

/**
 * Find the thread for a stay, opening one if this is the first message.
 *
 * Inside the caller's transaction, so the thread and the message that caused it
 * commit together. A thread created on its own is an empty conversation sitting
 * in a queue waiting for a reply to nothing — which is exactly why there is no
 * insert policy for a session (rls-policies-map footnote 25).
 */
export async function openThreadIn(
  tx: Tx,
  input: { propertyId: string; reservationId: string; locale: string },
): Promise<ThreadRow> {
  const [existing] = await selectThread(tx).where(
    and(
      eq(messageThreads.reservationId, input.reservationId),
      eq(messageThreads.propertyId, input.propertyId),
    ),
  )

  if (existing) return existing

  const [reservation] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(eq(reservations.id, input.reservationId), eq(reservations.propertyId, input.propertyId)),
    )
    .limit(1)

  if (!reservation) throw new MessageRejected('no such reservation for this property')

  const [created] = await tx
    .insert(messageThreads)
    .values({
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      locale: input.locale,
      status: 'open',
    })
    // Two messages arriving at once — a guest double-tapping send — must not
    // produce two threads. The unique constraint decides; this reads the winner.
    .onConflictDoNothing({ target: messageThreads.reservationId })
    .returning({ id: messageThreads.id })

  if (created) {
    await emit(tx, {
      propertyId: input.propertyId,
      entityType: 'message_thread',
      entityId: created.id,
      eventType: 'thread.opened',
      origin: 'platform',
      actor: guestActor(input.reservationId),
    })
  }

  const [row] = await selectThread(tx).where(
    and(
      eq(messageThreads.reservationId, input.reservationId),
      eq(messageThreads.propertyId, input.propertyId),
    ),
  )

  if (!row) throw new MessageRejected('thread could not be opened')

  return row
}

/**
 * The guest said something (E3.2).
 *
 * Always leaves the thread `awaiting_reply`, including when it had been
 * `answered` or `escalated` — the guest is waiting again, and a thread that
 * stayed `answered` because the previous exchange had concluded is a thread the
 * SLA sweep will never look at.
 */
export async function appendGuestMessage(input: {
  propertyId: string
  reservationId: string
  locale: string
  body: string
  at?: Date
}): Promise<{ thread: ThreadRow; messageId: string }> {
  const body = normaliseBody(input.body)
  const at = input.at ?? new Date()

  return asService((db) =>
    db.transaction(async (tx) => {
      const thread = await openThreadIn(tx, input)

      if (thread.status === 'closed') {
        // A guest writing after checkout is a guest with something to say. The
        // thread reopens rather than swallowing it.
        await tx
          .update(messageThreads)
          .set({ status: 'open', updatedAt: at })
          .where(eq(messageThreads.id, thread.id))
      }

      const messageId = await insertMessage(tx, {
        propertyId: input.propertyId,
        threadId: thread.id,
        author: 'guest',
        body,
        at,
      })

      const [updated] = await tx
        .update(messageThreads)
        .set({
          // Not touched when a person already holds it: taking a thread over is
          // a commitment, and a second guest message must not silently release
          // it back into the unowned queue.
          status: thread.status === 'escalated' ? 'escalated' : 'awaiting_reply',
          lastGuestMessageAt: at,
          updatedAt: at,
        })
        .where(eq(messageThreads.id, thread.id))
        .returning(threadColumns)

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: thread.id,
        eventType: 'message.received',
        origin: 'platform',
        actor: guestActor(input.reservationId),
        payload: { messageId, length: body.length },
      })

      return { thread: updated ?? thread, messageId }
    }),
  )
}

/**
 * The concierge answered (E3.2).
 *
 * `agentRunId` is required, not optional. The tool-boundary audit compares a
 * reply against the tool outputs of *its own run*, and a reply with no run
 * attached is a sentence nobody can check — which is the one thing this design
 * exists to prevent. The database agrees: `messages_agent_run_only_for_agent`.
 */
export async function appendAgentMessage(input: {
  propertyId: string
  threadId: string
  agentRunId: string
  agent: string
  body: string
  at?: Date
}): Promise<string> {
  const body = normaliseBody(input.body)
  const at = input.at ?? new Date()

  return asService((db) =>
    db.transaction(async (tx) => {
      const messageId = await insertMessage(tx, {
        propertyId: input.propertyId,
        threadId: input.threadId,
        author: 'agent',
        body,
        agentRunId: input.agentRunId,
        at,
      })

      await tx
        .update(messageThreads)
        .set({ status: 'answered', lastReplyAt: at, updatedAt: at })
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.propertyId, input.propertyId),
            // Never overwrites an escalation. If a person took the thread while
            // the run was in flight, the person owns it and the agent's answer
            // is recorded without pretending the thread is handled.
            eq(messageThreads.status, 'awaiting_reply'),
          ),
        )

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'message.answered',
        origin: 'platform',
        actor: agentActor(input.agent),
        payload: { messageId, agentRunId: input.agentRunId },
      })

      return messageId
    }),
  )
}

/** A person answered (E3.3). */
export async function appendStaffMessage(input: {
  propertyId: string
  threadId: string
  userId: string
  body: string
  at?: Date
}): Promise<string> {
  const body = normaliseBody(input.body)
  const at = input.at ?? new Date()

  return asService((db) =>
    db.transaction(async (tx) => {
      const messageId = await insertMessage(tx, {
        propertyId: input.propertyId,
        threadId: input.threadId,
        author: 'staff',
        authorUserId: input.userId,
        body,
        at,
      })

      await tx
        .update(messageThreads)
        .set({
          status: 'answered',
          lastReplyAt: at,
          updatedAt: at,
          // Answering takes the thread. Somebody who replies has picked it up
          // whether or not they pressed the button first, and leaving it
          // unassigned would show it as unowned work in the console.
          assignedTo: input.userId,
          // Cleared: it has been dealt with, and a stale reason on a thread that
          // reopens later would explain the wrong escalation.
          escalationReason: null,
          slaAlertedAt: null,
        })
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.propertyId, input.propertyId),
          ),
        )

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'message.answered',
        origin: 'platform',
        actor: userActor(input.userId),
        payload: { messageId },
      })

      return messageId
    }),
  )
}

/**
 * Hand the thread to a person (E3.2).
 *
 * Unassigned on purpose: escalating means "a human is needed", not "this human
 * is needed". A ten-room property has one to three people and no routing rules
 * worth configuring (design-notes/stay-messaging.md §4E); the console shows
 * unowned threads loudly and somebody takes it.
 *
 * The `reason` is shown to staff, never to the guest. A guest reading "the
 * model was not confident" learns nothing they can use.
 */
export async function escalateThread(input: {
  propertyId: string
  threadId: string
  reason: string
  actor?: Actor
  /** A note appended to the thread for the guest, when there is one to make. */
  guestNotice?: string
  at?: Date
}): Promise<void> {
  const at = input.at ?? new Date()

  await asService((db) =>
    db.transaction(async (tx) => {
      const [updated] = await tx
        .update(messageThreads)
        .set({
          status: 'escalated',
          escalatedAt: at,
          escalationReason: input.reason.slice(0, 500),
          updatedAt: at,
        })
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.propertyId, input.propertyId),
            // Already escalated and already owned stays owned. Re-escalating
            // would reset the clock the SLA alert is measured from, so a thread
            // somebody is working on would page them about itself.
            or(
              eq(messageThreads.status, 'awaiting_reply'),
              eq(messageThreads.status, 'open'),
              eq(messageThreads.status, 'answered'),
            ),
          ),
        )
        .returning({ id: messageThreads.id })

      if (!updated) return

      if (input.guestNotice) {
        await insertMessage(tx, {
          propertyId: input.propertyId,
          threadId: input.threadId,
          author: 'system',
          body: input.guestNotice,
          at,
        })
      }

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'thread.escalated',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: { reason: input.reason },
      })
    }),
  )
}

/** One tap: this is mine now (E3.3). */
export async function takeOverThread(input: {
  propertyId: string
  threadId: string
  userId: string
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(messageThreads)
        .set({ assignedTo: input.userId, status: 'escalated', updatedAt: new Date() })
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.propertyId, input.propertyId),
          ),
        )

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'thread.taken-over',
        origin: 'platform',
        actor: userActor(input.userId),
      })
    }),
  )
}

/**
 * One tap: not mine after all (E3.3).
 *
 * Returns the thread to the unowned queue rather than to the concierge. The
 * agent escalated it once already; handing it back to be escalated again is a
 * loop with a guest at the bottom of it.
 */
export async function handBackThread(input: {
  propertyId: string
  threadId: string
  userId: string
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(messageThreads)
        .set({ assignedTo: null, status: 'escalated', updatedAt: new Date() })
        .where(
          and(
            eq(messageThreads.id, input.threadId),
            eq(messageThreads.propertyId, input.propertyId),
          ),
        )

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'thread.handed-back',
        origin: 'platform',
        actor: userActor(input.userId),
      })
    }),
  )
}

/** A note from the product itself: arrival, checkout, the AI disclosure. */
export async function appendSystemMessageIn(
  tx: Tx,
  input: { propertyId: string; threadId: string; body: string; at?: Date },
): Promise<string> {
  return insertMessage(tx, {
    propertyId: input.propertyId,
    threadId: input.threadId,
    author: 'system',
    body: normaliseBody(input.body),
    at: input.at ?? new Date(),
  })
}

/**
 * The same, on its own connection.
 *
 * A system note does not move the thread's status: it is the product speaking
 * about itself, not an answer, and marking a thread `answered` because we told
 * the guest they are talking to software would take it out of the queue with
 * their question still unanswered.
 */
export async function appendSystemMessage(input: {
  propertyId: string
  threadId: string
  body: string
  at?: Date
}): Promise<string> {
  return asService((db) => db.transaction((tx) => appendSystemMessageIn(tx, input)))
}

/** The thread for a stay, or null. */
export async function getThreadForReservation(
  propertyId: string,
  reservationId: string,
): Promise<ThreadRow | null> {
  const [row] = await asService((db) =>
    selectThread(db).where(
      and(
        eq(messageThreads.reservationId, reservationId),
        eq(messageThreads.propertyId, propertyId),
      ),
    ),
  )

  return row ?? null
}

/** Everything said in a thread, oldest first — which is how a conversation reads. */
export async function listMessages(propertyId: string, threadId: string): Promise<MessageRow[]> {
  return asService((db) =>
    db
      .select({
        id: messages.id,
        author: messages.author,
        authorUserId: messages.authorUserId,
        body: messages.body,
        agentRunId: messages.agentRunId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.threadId, threadId), eq(messages.propertyId, propertyId)))
      .orderBy(asc(messages.createdAt)),
  )
}

/**
 * Threads escalated longer ago than the property tolerates and not yet alerted
 * on (E3.2: unanswered-escalation SLA alert).
 *
 * Reads `sla_alerted_at` rather than recomputing from messages, so the alert
 * fires once. A sweep that re-alerted every run would train an owner to ignore
 * the alert, which costs more than the missed reply it was warning about.
 */
export async function listOverdueEscalations(input: {
  minutes: number
  now?: Date
  limit?: number
}): Promise<{ id: string; propertyId: string; reservationId: string; escalatedAt: Date | null }[]> {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - input.minutes * 60_000)

  return asService((db) =>
    db
      .select({
        id: messageThreads.id,
        propertyId: messageThreads.propertyId,
        reservationId: messageThreads.reservationId,
        escalatedAt: messageThreads.escalatedAt,
      })
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.status, 'escalated'),
          isNull(messageThreads.slaAlertedAt),
          lt(messageThreads.escalatedAt, cutoff),
        ),
      )
      .orderBy(asc(messageThreads.escalatedAt))
      .limit(input.limit ?? 200),
  )
}

/** Stamped when the alert has gone out, so it goes out once. */
export async function markSlaAlerted(propertyId: string, threadId: string): Promise<void> {
  await asService((db) =>
    db
      .update(messageThreads)
      .set({ slaAlertedAt: new Date() })
      .where(and(eq(messageThreads.id, threadId), eq(messageThreads.propertyId, propertyId))),
  )
}

/**
 * Record something a guest asked for (E3.4).
 *
 * What `create_task` calls. The row is the difference between an agent saying
 * "I will let them know" and somebody actually knowing.
 */
export async function createStayTask(input: {
  propertyId: string
  reservationId: string
  threadId?: string | null
  summary: string
  actor: Actor
}): Promise<string> {
  const summary = input.summary.trim().slice(0, 500)
  if (!summary) throw new MessageRejected('a task needs a summary')

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(stayTasks)
        .values({
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          threadId: input.threadId ?? null,
          summary,
          createdBy: formatCreator(input.actor),
        })
        .returning({ id: stayTasks.id })

      if (!row) throw new MessageRejected('task insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'stay_task',
        entityId: row.id,
        eventType: 'task.created',
        origin: 'platform',
        actor: input.actor,
        payload: { reservationId: input.reservationId, summary },
      })

      return row.id
    }),
  )
}

/** Open tasks for a stay, newest first. */
export async function listStayTasks(
  propertyId: string,
  reservationId: string,
): Promise<{ id: string; summary: string; status: string; createdAt: Date }[]> {
  return asService((db) =>
    db
      .select({
        id: stayTasks.id,
        summary: stayTasks.summary,
        status: stayTasks.status,
        createdAt: stayTasks.createdAt,
      })
      .from(stayTasks)
      .where(and(eq(stayTasks.propertyId, propertyId), eq(stayTasks.reservationId, reservationId)))
      .orderBy(desc(stayTasks.createdAt)),
  )
}

// ---------------------------------------------------------------------------

const threadColumns = {
  id: messageThreads.id,
  propertyId: messageThreads.propertyId,
  reservationId: messageThreads.reservationId,
  status: messageThreads.status,
  locale: messageThreads.locale,
  assignedTo: messageThreads.assignedTo,
  escalationReason: messageThreads.escalationReason,
  lastGuestMessageAt: messageThreads.lastGuestMessageAt,
  lastReplyAt: messageThreads.lastReplyAt,
  escalatedAt: messageThreads.escalatedAt,
}

function selectThread(db: Tx) {
  return db.select(threadColumns).from(messageThreads).limit(1)
}

async function insertMessage(
  tx: Tx,
  input: {
    propertyId: string
    threadId: string
    author: 'guest' | 'agent' | 'staff' | 'system'
    authorUserId?: string
    body: string
    agentRunId?: string
    at: Date
  },
): Promise<string> {
  const [row] = await tx
    .insert(messages)
    .values({
      propertyId: input.propertyId,
      threadId: input.threadId,
      author: input.author,
      authorUserId: input.authorUserId ?? null,
      body: input.body,
      agentRunId: input.agentRunId ?? null,
      createdAt: input.at,
    })
    .returning({ id: messages.id })

  if (!row) throw new MessageRejected('message insert returned no row')

  return row.id
}

function normaliseBody(body: string): string {
  const trimmed = body.trim()

  if (!trimmed) throw new MessageRejected('an empty message is not a message')
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    // Refused rather than truncated. Silently cutting a guest's message in half
    // means answering a question they did not finish asking.
    throw new MessageRejected(`a message may be at most ${MAX_MESSAGE_LENGTH} characters`)
  }

  return trimmed
}

/** The `stay_tasks.created_by` vocabulary, matching `domain_events.actor`. */
function formatCreator(actor: Actor): string {
  switch (actor.kind) {
    case 'user':
      return `staff:${actor.userId}`
    case 'agent':
      return `agent:${actor.agent}`
    case 'guest':
      return 'guest'
    case 'system':
      return 'system'
  }
}
