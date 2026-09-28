import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  agentRuns,
  domainEvents,
  guests,
  messageThreads,
  reservations,
  stayTasks,
} from '../db/schema'
import { emit } from '../events'
import { userActor } from '../events/actor'

/**
 * The approval surface and the action log (Guest Desk WP0.6, ADR-021).
 *
 * The concierge holds money-shaped actions for a person (`pending_approval`
 * calls) and records every action it takes. This module reads both back for
 * staff, records their decisions on the run itself — `agent_runs.outcome` and
 * `reviewed_by`, the fields ADR-011 reserved for exactly this — and reverses
 * what has a reversal. Every decision and reversal is an event (binding rule 2).
 */

interface StoredCall {
  tool?: string
  status?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  reversible?: boolean
}

function calls(value: unknown): StoredCall[] {
  return Array.isArray(value) ? (value as StoredCall[]) : []
}

export interface PendingApproval {
  runId: string
  at: Date
  tool: string
  input: Record<string, unknown>
  threadId: string | null
  reservationId: string | null
  guestName: string | null
}

/**
 * Actions the concierge held for a person and nobody has decided yet — the
 * run's `outcome` is still null (WP0.6). Oldest first: the guest who has waited
 * longest.
 */
export async function listPendingApprovals(
  propertyId: string,
  days = 14,
): Promise<PendingApproval[]> {
  const rows = await asService((db) =>
    db
      .select({
        runId: agentRuns.id,
        at: agentRuns.at,
        toolCalls: agentRuns.toolCalls,
        output: agentRuns.output,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.propertyId, propertyId),
          eq(agentRuns.agent, 'AG-01'),
          isNull(agentRuns.outcome),
          sql`${agentRuns.toolCalls} @> '[{"status":"pending_approval"}]'::jsonb`,
          sql`${agentRuns.at} > now() - make_interval(days => ${days})`,
        ),
      )
      .orderBy(asc(agentRuns.at)),
  )

  const threadIds = rows
    .map((row) => (row.output as { threadId?: unknown } | null)?.threadId)
    .filter((id): id is string => typeof id === 'string')

  const threads = threadIds.length
    ? await asService((db) =>
        db
          .select({
            id: messageThreads.id,
            reservationId: messageThreads.reservationId,
            guestName: guests.name,
          })
          .from(messageThreads)
          .innerJoin(reservations, eq(reservations.id, messageThreads.reservationId))
          .leftJoin(guests, eq(guests.id, reservations.guestId))
          .where(
            and(eq(messageThreads.propertyId, propertyId), inArray(messageThreads.id, threadIds)),
          ),
      )
    : []

  return rows.flatMap((row) => {
    const threadId = (row.output as { threadId?: unknown } | null)?.threadId
    const thread = threads.find((t) => t.id === threadId)

    return calls(row.toolCalls)
      .filter((call) => call.status === 'pending_approval' && typeof call.tool === 'string')
      .map((call) => ({
        runId: row.runId,
        at: row.at,
        tool: call.tool as string,
        input: call.input ?? {},
        threadId: typeof threadId === 'string' ? threadId : null,
        reservationId: thread?.reservationId ?? null,
        guestName: thread?.guestName ?? null,
      }))
  })
}

export type DecisionOutcome =
  { status: 'decided'; approval: PendingApproval } | { status: 'rejected'; reason: string }

/**
 * Record a person's decision on a held action. Once: a run already decided is
 * refused, so two members tapping at once cannot both approve a cancellation.
 * Executing an approved action is the caller's job — it needs the payment
 * adapter or the api, which core does not hold.
 */
export async function decideApproval(input: {
  propertyId: string
  runId: string
  decision: 'accepted' | 'rejected'
  userId: string
}): Promise<DecisionOutcome> {
  const pending = (await listPendingApprovals(input.propertyId, 3650)).find(
    (p) => p.runId === input.runId,
  )
  if (!pending) return { status: 'rejected', reason: 'nothing pending for this run' }

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(agentRuns)
        .set({ outcome: input.decision, reviewedBy: input.userId })
        .where(
          and(
            eq(agentRuns.id, input.runId),
            eq(agentRuns.propertyId, input.propertyId),
            isNull(agentRuns.outcome),
          ),
        )
        .returning({ id: agentRuns.id })

      // Somebody else decided between the read and the write.
      if (!row) return { status: 'rejected' as const, reason: 'already decided' }

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'agent_run',
        entityId: input.runId,
        eventType: 'approval.decided',
        origin: 'platform',
        actor: userActor(input.userId),
        payload: { tool: pending.tool, decision: input.decision },
      })

      return { status: 'decided' as const, approval: pending }
    }),
  )
}

export interface ThreadAction {
  runId: string
  callIndex: number
  tool: string
  status: string
  reversible: boolean
  /** For a held call: what the person decided, or null while it waits. */
  decision: 'accepted' | 'rejected' | null
  /** A reversal exists for this call and has not been used. */
  canReverse: boolean
  reversedAt: Date | null
}

/** Tools whose effect is a task, reversed by cancelling it (WP0.6). */
const TASK_TOOLS = new Set(['modify_booking', 'request_late_checkout'])

/**
 * The concierge's actions on one thread, grouped by run — what staff see beside
 * each reply. Router bookkeeping (`escalate`) is left out: the thread already
 * shows the handover it produced.
 */
export async function listThreadActions(
  propertyId: string,
  threadId: string,
): Promise<Map<string, ThreadAction[]>> {
  const runs = await asService((db) =>
    db
      .select({ id: agentRuns.id, toolCalls: agentRuns.toolCalls, outcome: agentRuns.outcome })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.propertyId, propertyId),
          sql`${agentRuns.output} ->> 'threadId' = ${threadId}`,
        ),
      )
      .orderBy(desc(agentRuns.at)),
  )

  const reversals = runs.length
    ? await asService((db) =>
        db
          .select({
            entityId: domainEvents.entityId,
            payload: domainEvents.payload,
            at: domainEvents.at,
          })
          .from(domainEvents)
          .where(
            and(
              eq(domainEvents.propertyId, propertyId),
              eq(domainEvents.eventType, 'agent_action.reversed'),
              inArray(
                domainEvents.entityId,
                runs.map((run) => run.id),
              ),
            ),
          ),
      )
    : []

  const byRun = new Map<string, ThreadAction[]>()

  for (const run of runs) {
    const actions = calls(run.toolCalls)
      .map((call, callIndex) => ({ call, callIndex }))
      .filter(({ call }) => typeof call.tool === 'string' && call.tool !== 'escalate')
      .map(({ call, callIndex }) => {
        const reversal = reversals.find(
          (event) =>
            event.entityId === run.id &&
            (event.payload as { callIndex?: unknown })?.callIndex === callIndex,
        )
        const taskReversal =
          TASK_TOOLS.has(call.tool as string) && typeof call.output?.taskId === 'string'

        return {
          runId: run.id,
          callIndex,
          tool: call.tool as string,
          status: call.status ?? 'done',
          reversible: call.reversible === true,
          decision:
            call.status === 'pending_approval' &&
            (run.outcome === 'accepted' || run.outcome === 'rejected')
              ? run.outcome
              : null,
          canReverse: call.status === 'done' && taskReversal && !reversal,
          reversedAt: reversal?.at ?? null,
        }
      })

    if (actions.length > 0) byRun.set(run.id, actions)
  }

  return byRun
}

export type ReverseOutcome = { status: 'reversed' } | { status: 'rejected'; reason: string }

/**
 * Undo one of the concierge's actions (WP0.6 "Annulla").
 *
 * Only where a reversal really exists: today, cancelling the task a date change
 * or a late-checkout request created. A link already sent or an email already
 * delivered cannot be unsent, and pretending otherwise would be the worst kind
 * of button. The reversal is its own event, linked to the run it undoes.
 */
export async function reverseAction(input: {
  propertyId: string
  runId: string
  callIndex: number
  userId: string
}): Promise<ReverseOutcome> {
  const [run] = await asService((db) =>
    db
      .select({ toolCalls: agentRuns.toolCalls, output: agentRuns.output })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.propertyId, input.propertyId)))
      .limit(1),
  )
  const call = calls(run?.toolCalls)[input.callIndex]
  if (!run || !call) return { status: 'rejected', reason: 'no such action' }

  const threadId = (run.output as { threadId?: unknown } | null)?.threadId
  const actions =
    typeof threadId === 'string' ? await listThreadActions(input.propertyId, threadId) : new Map()
  const action = (actions.get(input.runId) as ThreadAction[] | undefined)?.find(
    (a) => a.callIndex === input.callIndex,
  )
  if (!action?.canReverse)
    return { status: 'rejected', reason: 'this action has no reversal, or it was already reversed' }

  const taskId = call.output?.taskId as string

  return asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(stayTasks)
        .set({ status: 'cancelled' })
        .where(and(eq(stayTasks.id, taskId), eq(stayTasks.propertyId, input.propertyId)))

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'stay_task',
        entityId: taskId,
        eventType: 'task.cancelled',
        origin: 'platform',
        actor: userActor(input.userId),
        payload: { reversedRun: input.runId },
      })

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'agent_run',
        entityId: input.runId,
        eventType: 'agent_action.reversed',
        origin: 'platform',
        actor: userActor(input.userId),
        payload: { callIndex: input.callIndex, tool: call.tool },
      })

      return { status: 'reversed' as const }
    }),
  )
}

/** The owner's recent questions to their assistant and its answers (AG-06, WP0.7). */
export async function listOwnerAnswers(
  propertyId: string,
  limit = 10,
): Promise<{ runId: string; at: Date; question: string; reply: string; understood: boolean }[]> {
  const rows = await asService((db) =>
    db
      .select({ id: agentRuns.id, at: agentRuns.at, output: agentRuns.output })
      .from(agentRuns)
      .where(and(eq(agentRuns.propertyId, propertyId), eq(agentRuns.agent, 'AG-06')))
      .orderBy(desc(agentRuns.at))
      .limit(limit),
  )

  return rows.map((row) => {
    const output = (row.output ?? {}) as Record<string, unknown>
    return {
      runId: row.id,
      at: row.at,
      question: typeof output.question === 'string' ? output.question : '',
      reply: typeof output.reply === 'string' ? output.reply : '',
      understood: output.understood !== false,
    }
  })
}
