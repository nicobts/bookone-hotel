import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { previewGuestTurn, previewOwnerTurn } from '@bookone/agents/preview'
import { NotADemoProperty } from '@bookone/core/preview'
import { ensureAgentsReady } from '@/lib/agents'
import { logger } from '@/lib/logger'
import { requireStaff } from '@/lib/staff'

export const dynamic = 'force-dynamic'

interface Body {
  messages?: UIMessage[]
  propertyId?: string
  mode?: 'guest' | 'owner'
  reservationId?: string
  ownerPhone?: string
  locale?: string
}

/**
 * The agent playground's endpoint (ADR-037): the AI SDK UI message stream, fed
 * by one real turn of our agents — never by a model directly.
 *
 * What is streamed is what the turn wrote: the assistant's reply as recorded
 * (ADR-022), the product's own lines (disclosure, handover) as notes, and a
 * `data-run` part with what the run decided. Demo properties only; the core
 * refuses anything else.
 */
export async function POST(request: Request) {
  const staff = await requireStaff()
  const body = (await request.json().catch(() => ({}))) as Body

  const last = body.messages?.at(-1)
  const text =
    last?.role === 'user'
      ? last.parts
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join('')
          .trim()
      : ''
  if (!text || !body.propertyId || !body.mode) {
    return Response.json({ error: 'propertyId, mode and a message are required' }, { status: 400 })
  }
  if (body.mode === 'guest' && !body.reservationId) {
    return Response.json({ error: 'reservationId is required' }, { status: 400 })
  }
  if (body.mode === 'owner' && !body.ownerPhone) {
    return Response.json({ error: 'ownerPhone is required' }, { status: 400 })
  }

  ensureAgentsReady()
  const locale = body.locale ?? 'it'

  let turn
  try {
    turn =
      body.mode === 'guest'
        ? await previewGuestTurn({
            propertyId: body.propertyId,
            reservationId: body.reservationId!,
            message: text,
            locale,
            appUrl: process.env.APP_URL ?? 'http://localhost:3000',
          })
        : await previewOwnerTurn({
            propertyId: body.propertyId,
            ownerPhone: body.ownerPhone!,
            message: text,
            locale,
          })
  } catch (error) {
    if (error instanceof NotADemoProperty) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    throw error
  }

  logger.info(
    {
      staff: staff.id,
      propertyId: body.propertyId,
      mode: body.mode,
      outcome: turn.outcome,
      runId: turn.run?.runId ?? null,
    },
    'playground turn',
  )

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      turn.replies.forEach((reply, index) => {
        if (reply.author === 'system') {
          writer.write({ type: 'data-note', data: reply.body })
          return
        }
        const id = `reply-${index}`
        writer.write({ type: 'text-start', id })
        writer.write({ type: 'text-delta', id, delta: reply.body })
        writer.write({ type: 'text-end', id })
      })
      writer.write({ type: 'data-run', data: { outcome: turn.outcome, run: turn.run } })
    },
  })

  return createUIMessageStreamResponse({ stream })
}
