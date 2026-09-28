import { randomUUID } from 'node:crypto'
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { getTranslations } from 'next-intl/server'
import { getUserPropertyBySlug } from '@bookone/core/db'
import { isEntitled } from '@bookone/core/onboarding'
import { readRunByRequest } from '@bookone/core/preview'
import { getCurrentUser } from '@/lib/auth/current-user'
import { logger } from '@/lib/logger'
import { askOwnerAssistant, previewConcierge } from '@/lib/worker'

export const dynamic = 'force-dynamic'

interface Body {
  property?: string
  locale?: string
  agent?: 'AG-01' | 'AG-06'
  reservationId?: string | null
  messages?: UIMessage[]
}

/** How long to wait for the worker's run before telling the member so. */
const WAIT_MS = 30_000
const POLL_MS = 400

/**
 * The console's chat endpoint (ADR-037 protocol, ADR-038 rules).
 *
 * The console never runs an agent: this checks the member, hands the turn to
 * the worker through `apps/api`, and reads the resulting run back under the
 * member's own session. For the concierge that is a *preview* — read tools
 * real, everything else simulated; for the owner assistant, which only reads,
 * it is the real thing, and the owner only.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'unauthorised' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as Body
  const locale = body.locale ?? 'it'
  const property = body.property ? await getUserPropertyBySlug(user.id, body.property) : null
  // Not a member: the same 404 a URL for somebody else's property gets (ADR-016).
  if (!property) return Response.json({ error: 'not found' }, { status: 404 })
  if (!(await isEntitled(property.id, 'concierge'))) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  if (body.agent === 'AG-06' && property.role !== 'owner') {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  if (body.agent !== 'AG-01' && body.agent !== 'AG-06') {
    return Response.json({ error: 'unknown agent' }, { status: 400 })
  }

  const last = body.messages?.at(-1)
  const text =
    last?.role === 'user'
      ? last.parts
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join('')
          .trim()
      : ''
  if (!text) return Response.json({ error: 'a message is required' }, { status: 400 })

  const requestId = randomUUID()
  const sent =
    body.agent === 'AG-01'
      ? await previewConcierge({
          propertyId: property.id,
          userId: user.id,
          message: text,
          locale,
          requestId,
          ...(body.reservationId ? { reservationId: body.reservationId } : {}),
        })
      : await askOwnerAssistant({
          propertyId: property.id,
          userId: user.id,
          message: text,
          locale,
          requestId,
        })

  const t = await getTranslations({ locale, namespace: 'console.agents' })
  const tAssistant = await getTranslations({ locale, namespace: 'console.assistant' })

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      if (!sent) {
        writer.write({ type: 'data-note', data: tAssistant('unavailable') })
        return
      }

      const deadline = Date.now() + WAIT_MS
      let run = await readRunByRequest(user.id, property.id, requestId)
      while (!run && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        run = await readRunByRequest(user.id, property.id, requestId)
      }

      if (!run) {
        logger.warn({ propertyId: property.id, agent: body.agent }, 'console chat: no run in time')
        writer.write({ type: 'data-note', data: tAssistant('timeout') })
        return
      }

      const reply =
        run.reply ||
        (body.agent === 'AG-06' ? tAssistant('notUnderstood') : t('outcomeNotUnderstood'))
      writer.write({ type: 'text-start', id: run.runId })
      writer.write({ type: 'text-delta', id: run.runId, delta: reply })
      writer.write({ type: 'text-end', id: run.runId })
      writer.write({
        type: 'data-run',
        data: {
          agent: run.agent,
          outcome: run.outcome,
          profile: run.profile,
          hardRule: run.hardRule,
          tier: run.tier,
          routeSource: run.routeSource,
          model: run.model,
          tools: run.tools,
          preview: body.agent === 'AG-01',
        },
      })
    },
  })

  return createUIMessageStreamResponse({ stream })
}
