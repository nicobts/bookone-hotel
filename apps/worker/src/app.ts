import { Hono } from 'hono'
import type { Logger } from 'pino'
import type { JobQueue } from '@bookone/core/jobs'
import type { PmsAdapter } from '@bookone/core/adapters'

/**
 * The worker's HTTP surface.
 *
 * Deliberately thin: this process exists for jobs, connectors and the agent
 * runner. What it exposes over HTTP is health and a small internal surface for
 * the console to nudge work — later, the typed tool endpoints shared with the
 * voice concierge workstream (WS-B).
 *
 * Routes are chained rather than registered separately so the exported type
 * carries them; that type is what gives `apps/web` end-to-end types through
 * Hono RPC without codegen (ADR-004, binding rule 10).
 */
export function createApp(deps: { queue: JobQueue; adapter: PmsAdapter; logger: Logger }) {
  const { queue, adapter } = deps

  return (
    new Hono()
      .get('/health', (c) => c.json({ status: 'ok' as const, service: 'worker' as const }))

      /**
       * Connector health, surfaced in the console.
       *
       * Owners see connector status honestly (03 §8) — including when it is bad.
       * A health endpoint that reports OK while the PMS refuses every call is
       * worse than none, because it converts a visible outage into a mystery.
       */
      .get('/health/connector', async (c) => {
        const health = await adapter.healthCheck()

        return c.json(
          {
            system: adapter.system,
            healthy: health.healthy,
            message: health.message ?? null,
            checkedAt: health.checkedAt.toISOString(),
          },
          health.healthy ? 200 : 503,
        )
      })

      /**
       * Re-enqueue a reflection.
       *
       * The one-tap resolution behind an unreflected reservation in the
       * exceptions inbox (PRD C1). Safe to call repeatedly: the singleton key
       * collapses duplicates, and the adapter is idempotent underneath — so an
       * owner tapping retry four times still produces one booking.
       */
      .post('/jobs/reservation-reflect', async (c) => {
        const body = await c.req.json<{ propertyId?: string; reservationId?: string }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const id = await queue.send(
          'reservation.reflect',
          { propertyId: body.propertyId, reservationId: body.reservationId },
          { singletonKey: `reflect:${body.reservationId}` },
        )

        return c.json({ enqueued: id })
      })
  )
}

export type AppType = ReturnType<typeof createApp>
