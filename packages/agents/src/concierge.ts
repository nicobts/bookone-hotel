import {
  appendAgentMessage,
  appendSystemMessage,
  disclosurePhrase,
  escalateThread,
  getReservationFacts,
  listMessages,
} from '@bookone/core/concierge'
import { agentActor } from '@bookone/core/events'
import { runAgent, type RunOutcome } from './runner'

/**
 * One turn of the conversation (E3.2).
 *
 * Ties the agent runner to the thread: run AG-01, write down what it decided,
 * and move the thread to whoever owes the next reply. Lives here rather than in
 * core because it needs the runner, and core must not know agents exist —
 * `packages/core` is the domain, and an agent is one of several things that can
 * drive it.
 *
 * ## Every path writes something
 *
 * Answer, escalation, or crash. A turn that produced nothing visible is a guest
 * staring at a thread where their message sits alone, deciding whether to walk
 * to the desk — which is the exact outcome this feature exists to prevent. So
 * the failure path escalates rather than returning quietly: if the concierge
 * broke, a person is the right answer anyway.
 */

export interface RespondInput {
  propertyId: string
  reservationId: string
  threadId: string
  locale: string
  /** The guest's message. Data, never instructions (06 §4 injection guardrail). */
  message: string
  /** Set when the guest used an explicit "make a request" affordance. */
  intent?: 'question' | 'request'
  triggerEventId?: bigint
}

export type RespondOutcome =
  | { status: 'answered'; runId: string; messageId: string }
  | { status: 'escalated'; runId: string; reason: string }
  | { status: 'failed'; runId: string; reason: string }

export async function respondToGuestMessage(input: RespondInput): Promise<RespondOutcome> {
  /*
   * Read once, up front, so the agent's own message cannot influence which
   * property or stay is in scope. `businessHours` is the only thing that flows
   * into what the guest reads, and it is a stored string.
   */
  const facts = await getReservationFacts(input.propertyId, input.reservationId)

  const run: RunOutcome = await runAgent({
    agent: 'AG-01',
    propertyId: input.propertyId,
    reservationId: input.reservationId,
    threadId: input.threadId,
    locale: input.locale,
    ...(input.triggerEventId !== undefined ? { triggerEventId: input.triggerEventId } : {}),
    input: {
      message: input.message,
      ...(input.intent ? { intent: input.intent } : {}),
      ...(facts?.businessHours ? { businessHours: facts.businessHours } : {}),
    },
  })

  if (run.status === 'rejected') {
    const reason = String(run.output.error ?? 'the concierge failed')

    // A crashed agent still owes the guest a person. Escalating on failure is
    // not defensive coding — silence here is the worst available outcome.
    await escalateThread({
      propertyId: input.propertyId,
      threadId: input.threadId,
      reason: `concierge failed: ${reason}`,
      actor: agentActor('AG-01'),
    })

    return { status: 'failed', runId: run.runId, reason }
  }

  const reply = typeof run.output.reply === 'string' ? run.output.reply : ''
  const escalate = run.output.escalate === true

  if (reply) {
    await discloseOnce(input)

    await appendAgentMessage({
      propertyId: input.propertyId,
      threadId: input.threadId,
      agentRunId: run.runId,
      agent: 'AG-01',
      body: reply,
    })
  }

  if (escalate) {
    const reason = String(run.output.reason ?? 'handed to a person')

    await escalateThread({
      propertyId: input.propertyId,
      threadId: input.threadId,
      reason,
      actor: agentActor('AG-01'),
    })

    return { status: 'escalated', runId: run.runId, reason }
  }

  return { status: 'answered', runId: run.runId, messageId: run.runId }
}

/**
 * Say once, at the top of the thread, that this is software.
 *
 * EU AI Act: a person interacting with an AI system is told so. Once — a
 * disclaimer on every message is noise a guest stops reading, which is the same
 * as not disclosing at all (design-notes/stay-messaging.md §4C).
 *
 * ## Why it is a `system` message and not part of the reply
 *
 * The first version prepended it to the agent's own message, and that would
 * have failed the tool-boundary audit on its first run — correctly. The stored
 * body would have been the disclosure plus a tool phrase, which appears in no
 * tool output, and `unsourced_reply` is exactly the finding for a sentence the
 * agent sent that no tool produced.
 *
 * The audit was right and the code was wrong. A disclosure is the product
 * speaking about itself, not the concierge answering a question, and `system` is
 * the author kind that already means that. Worth recording: the check found a
 * real violation the same day it was written, in code written by the person who
 * wrote the check.
 */
async function discloseOnce(input: RespondInput): Promise<void> {
  const existing = await listMessages(input.propertyId, input.threadId)

  // Any previous agent turn means the guest has already been told.
  if (existing.some((message) => message.author === 'agent')) return

  await appendSystemMessage({
    propertyId: input.propertyId,
    threadId: input.threadId,
    body: disclosurePhrase(input.locale),
  })
}
