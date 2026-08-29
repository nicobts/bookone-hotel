import {
  createStayTask,
  escalatedOutOfHoursPhrase,
  escalatedPhrase,
  getReservationFacts,
  localisedName,
  reservationPhrase,
  searchKb,
  taskRecordedPhrase,
} from '@bookone/core/concierge'
import { agentActor } from '@bookone/core/events'
import type { Tool, ToolContext, ToolResult } from './index'

/**
 * AG-01's tools — the complete surface through which the concierge acts
 * (06 §2, ADR-011, the Concierge PRD §9 contracts shared with the voice
 * workstream).
 *
 * Every one of them returns a `phrase`: the exact sentence the guest will read.
 * That is the mechanism behind binding rule 7, and it is worth being precise
 * about what it buys. The agent does not receive facts and write a sentence; it
 * receives a sentence. There is no step at which a price, a date or a policy
 * passes through something that could rephrase it, which is why the
 * tool-boundary audit can assert `reply ⊆ tool output` and expect it to hold.
 *
 * ## What is deliberately absent
 *
 * No tool changes a booking, moves a date, quotes a price for a change, or
 * touches money. Those are T2 capabilities in 06 §2 — the agent proposes and a
 * human taps — and the proposal surface is Sprint 8. Until then the capability
 * does not exist, which is a stronger guarantee than a tier check: an agent
 * cannot call a tool nobody wrote.
 *
 * Fiscal-adjacent tools do not exist and will not (D11, ADR-011). Not gated:
 * absent.
 */

/**
 * Answer from the property's own knowledge base.
 *
 * The whole of what the concierge may say about a property. A miss is not a
 * failure — it is the escalation path working, and the KB being thin in Sprint 7
 * is expected (design-notes/stay-messaging.md §2).
 */
export const searchKbTool: Tool = {
  name: 'search_kb',
  description: 'Look up an answer the property has written for this question',

  run: async (context, input) => {
    const question = typeof input.question === 'string' ? input.question : ''
    if (!question.trim()) return { ok: false, output: { error: 'question is required' } }

    const locale = context.locale ?? 'en'
    const match = await searchKb(context.propertyId, question, locale)

    if (!match) {
      return {
        ok: true,
        output: {
          found: false,
          // No phrase. A tool that returns a sentence for a miss hands the agent
          // something to say when the honest answer is that it does not know.
          reason: 'no published article matches this question in this language',
        },
      }
    }

    return {
      ok: true,
      output: {
        found: true,
        phrase: match.answer,
        topic: match.topic,
        articleId: match.articleId,
        version: match.version,
        score: match.score,
      },
    }
  },
}

/**
 * What the guest's own booking says.
 *
 * Scoped by the runner to one reservation — the stay token already identified
 * them, so there is no lookup by name and no way to ask about somebody else's
 * booking. The Concierge PRD's voice version takes a surname and an arrival
 * date because a phone call has no token; this one does, and asking a guest to
 * identify themselves when we already know who they are is a worse experience
 * for no gain in safety.
 */
export const getReservationTool: Tool = {
  name: 'get_reservation',
  description: "State the facts of this guest's own booking",

  run: async (context): Promise<ToolResult> => {
    if (!context.reservationId) {
      return { ok: false, output: { error: 'no reservation in context' } }
    }

    const facts = await getReservationFacts(context.propertyId, context.reservationId)
    if (!facts) return { ok: true, output: { found: false } }

    const locale = context.locale ?? 'en'
    const roomName = localisedName(facts.roomNames, locale)

    return {
      ok: true,
      output: {
        found: true,
        phrase: reservationPhrase(locale, {
          reference: facts.reference,
          arrivalDate: facts.arrivalDate,
          departureDate: facts.departureDate,
          roomName,
          status: facts.status,
        }),
        reference: facts.reference,
        arrivalDate: facts.arrivalDate,
        departureDate: facts.departureDate,
        roomName,
      },
    }
  },
}

/**
 * The same lookup, by topic rather than by question.
 *
 * Separate from `search_kb` because a topic is an exact key and a question is
 * not: this is what a caller uses when it already knows the subject — the voice
 * workstream's intent classifier, or a link in the stay page that means "tell me
 * about parking". Routing it through the fuzzy matcher would let "parking"
 * resolve to an article about the car-free town centre.
 */
export const getPropertyInfoTool: Tool = {
  name: 'get_property_info',
  description: 'Return the property answer stored under an exact topic',

  run: async (context, input) => {
    const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
    if (!topic) return { ok: false, output: { error: 'topic is required' } }

    const locale = context.locale ?? 'en'
    const match = await searchKb(context.propertyId, topic, locale)

    if (!match || match.topic !== topic) {
      return { ok: true, output: { found: false, topic } }
    }

    return {
      ok: true,
      output: {
        found: true,
        phrase: match.answer,
        topic: match.topic,
        articleId: match.articleId,
        version: match.version,
      },
    }
  },
}

/**
 * Write down something the guest asked for (E3.4).
 *
 * The phrase this returns says the request is *recorded*, not that it is done —
 * "I have asked housekeeping" is a claim about a person the software has never
 * spoken to. A guest who is told it is recorded knows to ask again if nothing
 * happens; a guest who is told it is handled does not.
 */
export const createTaskTool: Tool = {
  name: 'create_task',
  description: 'Record a guest request as a task the property can see',

  run: async (context, input) => {
    if (!context.reservationId) {
      return { ok: false, output: { error: 'no reservation in context' } }
    }

    const summary = typeof input.summary === 'string' ? input.summary.trim() : ''
    if (!summary) return { ok: false, output: { error: 'summary is required' } }

    const taskId = await createStayTask({
      propertyId: context.propertyId,
      reservationId: context.reservationId,
      threadId: context.threadId ?? null,
      summary,
      actor: agentActor('AG-01'),
    })

    return {
      ok: true,
      output: { taskId, phrase: taskRecordedPhrase(context.locale ?? 'en') },
    }
  },
}

/**
 * Hand the conversation to a person.
 *
 * Returns the phrase the guest reads; the `reason` is for staff and is never
 * shown to the guest — "the match score was 0.31" tells them nothing they can
 * use. The escalation itself is performed by the runner, which owns the thread;
 * a tool that wrote thread state directly would be a second writer of it.
 *
 * `businessHours` is passed through when the property has recorded some, so the
 * guest is told when to expect an answer instead of watching a typing indicator
 * that means nothing (design-notes/stay-messaging.md §4D).
 */
export const escalateTool: Tool = {
  name: 'escalate',
  description: 'Hand this conversation to a person at the property',

  run: async (context, input) => {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : 'not answerable'
    const hours = typeof input.businessHours === 'string' ? input.businessHours.trim() : ''
    const locale = context.locale ?? 'en'

    return {
      ok: true,
      output: {
        escalate: true,
        reason,
        phrase: hours ? escalatedOutOfHoursPhrase(locale, hours) : escalatedPhrase(locale),
      },
    }
  },
}

export const conciergeTools: Tool[] = [
  searchKbTool,
  getReservationTool,
  getPropertyInfoTool,
  createTaskTool,
  escalateTool,
]

export type { ToolContext }
