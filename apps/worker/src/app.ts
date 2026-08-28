import { Hono } from 'hono'
import type { Logger } from 'pino'
import type { JobQueue } from '@bookone/core/jobs'
import type { PmsAdapter } from '@bookone/core/adapters'

/**
 * The worker's HTTP surface.
 *
 * Deliberately thin: this process exists for jobs, connectors and the agent
 * runner. What it exposes over HTTP is health and a small internal surface for
 * the console and the booking surface to nudge work — later, the typed tool
 * endpoints shared with the voice concierge workstream (WS-B).
 *
 * Routes are chained rather than registered separately so the exported type
 * carries them; that type is what gives `apps/web` end-to-end types through
 * Hono RPC without codegen (ADR-004, binding rule 10).
 */
export function createApp(deps: {
  queue: JobQueue
  adapter: PmsAdapter
  logger: Logger
  /** Shared secret for `/jobs/*`. See the middleware below. */
  internalToken: string
}) {
  const { queue, adapter, internalToken } = deps

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
       * Everything under `/jobs` is service-to-service and carries a shared
       * secret.
       *
       * This became necessary the moment a *public* page could reach these —
       * the booking surface confirms a reservation and then asks the worker to
       * reflect it. Without the check, anyone who can route to this process can
       * enqueue work against any property id they can guess: a queue full of
       * reflections is a PMS full of them.
       *
       * A shared secret rather than mTLS or a signed request because both
       * deployables are ours, in one EU region, and the secret is the smallest
       * thing that closes the hole. Compared in constant time so the endpoint
       * does not leak the token one byte at a time to anyone timing it.
       */
      .use('/jobs/*', async (c, next) => {
        // The scheme is required, not stripped if present. A header that is
        // just the token happens to carry the right secret, but it is not a
        // request this platform makes — accepting it means the one caller that
        // sends it is a caller nobody wrote, and that is worth a 401 rather
        // than a shrug.
        const header = c.req.header('authorization') ?? ''
        const match = /^Bearer (.+)$/.exec(header)

        if (!match || !timingSafeEqual(match[1] ?? '', internalToken)) {
          // No detail. "Wrong token" and "no token" are the same answer here.
          return c.json({ error: 'unauthorized' }, 401)
        }

        await next()
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

      /**
       * What a confirmed booking sets in motion (E1.2, E1.5).
       *
       * Called by the booking surface immediately after the confirming
       * transaction commits. Two jobs, enqueued together because they have the
       * same trigger and neither blocks the other: tell the PMS, tell the guest.
       *
       * Note what this endpoint does *not* do: confirm anything. The booking is
       * already real and already recorded when this is called, and the outbox
       * row already exists. If this call never lands, the sweep still sends the
       * confirmation and the exceptions inbox still surfaces the unreflected
       * reservation after sixty seconds. It is the fast path, not the only one —
       * which is what makes it safe for a public surface to depend on.
       */
      .post('/jobs/booking-confirmed', async (c) => {
        const body = await c.req.json<{
          propertyId?: string
          reservationId?: string
          notificationId?: string
        }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const reflect = await queue.send(
          'reservation.reflect',
          { propertyId: body.propertyId, reservationId: body.reservationId },
          { singletonKey: `reflect:${body.reservationId}` },
        )

        const notify = body.notificationId
          ? await queue.send(
              'notification.send',
              { propertyId: body.propertyId, notificationId: body.notificationId },
              { singletonKey: `notify:${body.notificationId}` },
            )
          : null

        return c.json({ reflect, notify })
      })
  )
}

export type AppType = ReturnType<typeof createApp>

/**
 * Constant-time string comparison.
 *
 * `===` returns as soon as two bytes differ, which over enough requests tells an
 * attacker how much of the token they have right. Hand-rolled rather than
 * `crypto.timingSafeEqual` because that one throws on a length mismatch, and
 * the throw is itself the length oracle.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (b.length === 0) return false

  let diff = a.length ^ b.length

  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length)
  }

  return diff === 0
}
