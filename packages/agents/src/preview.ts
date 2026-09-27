import {
  appendGuestMessage,
  getThreadForReservation,
  listMessages,
  type MessageRow,
} from '@bookone/core/concierge'
import {
  getPreviewRun,
  isDemoProperty,
  NotADemoProperty,
  type PreviewRun,
} from '@bookone/core/preview'
import { respondToGuestMessage, type RespondOutcome } from './concierge'
import { respondToOwner } from './owner'

/**
 * One turn in the agent playground (ADR-037).
 *
 * Not a simulation: the guest's message is written to the stay's thread and
 * the concierge answers exactly as it would a real guest — same orchestrator,
 * profiles, tools, approvals and `agent_runs` record. That is the point: what
 * the tester sees is what a guest would get. Which is also why it refuses
 * anything but a demo property.
 *
 * Returned: every message the turn wrote after the guest's (the reply, the
 * handover phrase, the disclosure on a first turn), and what the run decided.
 */
export interface PreviewTurn {
  outcome: RespondOutcome['status'] | 'answered' | 'not-understood' | 'refused'
  replies: { author: 'agent' | 'system' | 'staff'; body: string }[]
  run: PreviewRun | null
}

export async function previewGuestTurn(input: {
  propertyId: string
  reservationId: string
  message: string
  locale: string
  appUrl: string
}): Promise<PreviewTurn> {
  if (!(await isDemoProperty(input.propertyId))) throw new NotADemoProperty()

  const { thread, messageId } = await appendGuestMessage({
    propertyId: input.propertyId,
    reservationId: input.reservationId,
    locale: input.locale,
    body: input.message,
  })

  const outcome = await respondToGuestMessage({
    propertyId: input.propertyId,
    reservationId: input.reservationId,
    threadId: thread.id,
    locale: thread.locale,
    message: input.message,
    appUrl: input.appUrl,
  })

  const all = await listMessages(input.propertyId, thread.id)
  const after = all.slice(all.findIndex((m) => m.id === messageId) + 1)

  return {
    outcome: outcome.status,
    replies: after
      .filter(
        (m): m is MessageRow & { author: 'agent' | 'system' | 'staff' } => m.author !== 'guest',
      )
      .map((m) => ({ author: m.author, body: m.body })),
    run: outcome.runId ? await getPreviewRun(input.propertyId, outcome.runId) : null,
  }
}

/** The owner assistant (AG-06), as the property's first recorded owner number. */
export async function previewOwnerTurn(input: {
  propertyId: string
  ownerPhone: string
  message: string
  locale: string
}): Promise<PreviewTurn> {
  if (!(await isDemoProperty(input.propertyId))) throw new NotADemoProperty()

  const outcome = await respondToOwner({
    propertyId: input.propertyId,
    phone: input.ownerPhone,
    message: input.message,
    locale: input.locale,
  })

  if (outcome.status === 'refused') return { outcome: 'refused', replies: [], run: null }
  return {
    outcome: outcome.status,
    replies: outcome.status === 'answered' ? [{ author: 'agent', body: outcome.reply }] : [],
    run: await getPreviewRun(input.propertyId, outcome.runId),
  }
}

/** The stay's conversation so far, so the playground opens where it left off. */
export async function previewTranscript(
  propertyId: string,
  reservationId: string,
): Promise<MessageRow[]> {
  const thread = await getThreadForReservation(propertyId, reservationId)
  return thread ? listMessages(propertyId, thread.id) : []
}
