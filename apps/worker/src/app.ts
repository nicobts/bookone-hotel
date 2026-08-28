import { Hono } from 'hono'
import type { Logger } from 'pino'
import type { JobQueue } from '@bookone/core/jobs'
import type { PmsAdapter } from '@bookone/core/adapters'
import { cancelBooking, quoteCancellation } from '@bookone/core/booking'
import { applyJourneyCommand } from '@bookone/core/journey'
import { userActor } from '@bookone/core/events'
import {
  applyPaymentEvent,
  startCheckout,
  PaymentAdapterError,
  type PaymentAdapter,
  type PaymentEvent,
} from '@bookone/core/payments'
import type { MockPaymentAdapter } from '@bookone/adapters/mock-payment'

/**
 * The worker's HTTP surface.
 *
 * Deliberately thin: this process exists for jobs, connectors and the agent
 * runner. What it exposes over HTTP is health, the payment provider's webhook,
 * and a small internal surface for the console and the booking surface to nudge
 * work — later, the typed tool endpoints shared with the voice concierge
 * workstream (WS-B).
 *
 * Three different authentication models live here, and the differences are the
 * interesting part:
 *
 *   - `/health*` — none. A health check that needs a secret is one the
 *     platform's own probes cannot make.
 *   - `/jobs/*` — a shared bearer token. Both callers are ours.
 *   - `/webhooks/payments` — a payload signature. The caller is a third party
 *     that cannot hold our secrets, so the signature *is* the authentication.
 *
 * Routes are chained rather than registered separately so the exported type
 * carries them; that type is what gives `apps/web` end-to-end types through
 * Hono RPC without codegen (ADR-004, binding rule 10).
 */
export function createApp(deps: {
  queue: JobQueue
  adapter: PmsAdapter
  payments: PaymentAdapter
  logger: Logger
  /** Shared secret for `/jobs/*`. See the middleware below. */
  internalToken: string
  appUrl: string
  /**
   * Whether `/jobs/payment-simulate` exists at all.
   *
   * False in production. Not "returns 403 in production" — the route is never
   * registered, so there is nothing to find, nothing to probe, and no code path
   * from a request to a fabricated capture.
   */
  allowSimulation: boolean
}) {
  const { queue, adapter, payments, logger, internalToken, appUrl, allowSimulation } = deps

  /** Shared by the webhook and the simulator, so both take the identical path. */
  async function dispatch(event: PaymentEvent) {
    const outcome = await applyPaymentEvent({ adapter: payments }, event)

    if (outcome.status === 'confirmed' && event.type === 'payment.succeeded') {
      // The same two jobs a no-deposit confirmation fires. Enqueued here rather
      // than inside the domain function because the queue lives in this process
      // and core must not know it exists (ADR-005).
      await queue.send(
        'reservation.reflect',
        { propertyId: event.intent.propertyId, reservationId: outcome.reservationId },
        { singletonKey: `reflect:${outcome.reservationId}` },
      )

      if (outcome.notificationId) {
        await queue.send(
          'notification.send',
          { propertyId: event.intent.propertyId, notificationId: outcome.notificationId },
          { singletonKey: `notify:${outcome.notificationId}` },
        )
      }
    }

    return outcome
  }

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
       * Payment provider status, including whether it is simulated.
       *
       * MEMO: with the mock connected this reports `simulated: true`, and the
       * booking surface reads it to decide whether to warn the guest. Separate
       * from the connector health because the two fail independently and an
       * owner needs to know which one is down.
       */
      .get('/health/payments', async (c) => {
        const health = await payments.healthCheck()

        return c.json({
          provider: payments.provider,
          simulated: payments.simulated,
          healthy: health.healthy,
          message: health.message ?? null,
        })
      })

      /**
       * The payment provider's webhook — the only state authority (03 §7.2).
       *
       * Deliberately **outside** the `/jobs/*` bearer-token guard: a provider
       * cannot present our internal secret. The signature on the payload is the
       * authentication, which is why `parseWebhook` throws rather than returns
       * on a bad one.
       *
       * Answering promptly matters more than it looks: a provider that does not
       * get a 2xx redelivers for days, and every redelivery re-runs this.
       * Everything downstream is idempotent for exactly that reason.
       */
      .post('/webhooks/payments', async (c) => {
        const payload = await c.req.text()
        const signature =
          c.req.header('x-payment-signature') ?? c.req.header('stripe-signature') ?? null

        let event: PaymentEvent | null
        try {
          event = await payments.parseWebhook(payload, signature)
        } catch (cause) {
          const code = cause instanceof PaymentAdapterError ? cause.code : 'unknown'
          logger.warn({ code, provider: payments.provider }, 'rejected a payment webhook')

          // 400, never 5xx. A signature that does not match will not match on a
          // retry either, and a 5xx invites the provider to try all day.
          return c.json({ error: 'invalid webhook' }, 400)
        }

        if (!event) return c.json({ ignored: true })

        const outcome = await dispatch(event)

        logger.info(
          { type: event.type, outcome: outcome.status, provider: payments.provider },
          'payment webhook',
        )

        return c.json({ status: outcome.status })
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
       * transaction commits, on the no-deposit path. Two jobs, enqueued
       * together because they have the same trigger and neither blocks the
       * other: tell the PMS, tell the guest.
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

      /**
       * Start a payment for a held reservation (E1.3).
       *
       * Lives here rather than in the web app because the provider client lives
       * in this process — one place holds the credentials, and the booking
       * surface never talks to a payment provider directly.
       */
      .post('/jobs/checkout', async (c) => {
        const body = await c.req.json<{
          propertyId?: string
          reservationId?: string
          returnUrl?: string
        }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const outcome = await startCheckout(
          { adapter: payments },
          {
            propertyId: body.propertyId,
            reservationId: body.reservationId,
            returnUrl: body.returnUrl ?? appUrl,
          },
        )

        logger.info(
          { reservationId: body.reservationId, outcome: outcome.status },
          'checkout started',
        )

        return c.json({ ...outcome, simulated: payments.simulated })
      })

      /**
       * Cancel a booking and refund per policy (E1.4).
       *
       * Here rather than in the web app for the same reason as checkout: the
       * refund needs the payment provider, and exactly one process holds it.
       *
       * The web app showed the guest a refund figure before they pressed the
       * button; this recomputes it from the policy and the ledger rather than
       * accepting it, because the number travelled through a browser in
       * between.
       */
      .post('/jobs/cancel', async (c) => {
        const body = await c.req.json<{ propertyId?: string; reservationId?: string }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const outcome = await cancelBooking(
          { adapter: payments },
          { propertyId: body.propertyId, reservationId: body.reservationId },
        )

        if (outcome.status === 'cancelled') {
          // The PMS has to hear about it too — a cancellation the hotel never
          // sees is a room they hold empty (PRD A5: changes propagate like A3).
          await queue.send(
            'reservation.reflect',
            { propertyId: body.propertyId, reservationId: body.reservationId },
            { singletonKey: `reflect:cancel:${body.reservationId}` },
          )
        }

        logger.info(
          {
            reservationId: body.reservationId,
            outcome: outcome.status,
            ...(outcome.status === 'cancelled'
              ? { refundCents: outcome.refundCents, refundFailed: outcome.refundFailed }
              : {}),
          },
          'cancellation',
        )

        return c.json(outcome)
      })

      /**
       * What a guest would be refunded if they cancelled now (E1.4).
       *
       * Read-only, and shown *before* the confirm button. A cancel flow that
       * reveals what it kept afterwards is the fastest way to turn a routine
       * cancellation into a chargeback.
       */
      .post('/jobs/cancellation-quote', async (c) => {
        const body = await c.req.json<{ propertyId?: string; reservationId?: string }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const quote = await quoteCancellation({
          propertyId: body.propertyId,
          reservationId: body.reservationId,
        })

        if (!quote) return c.json({ error: 'unknown reservation' }, 404)

        return c.json(quote)
      })

      /**
       * The guest has arrived (E3.1).
       *
       * Only reservation-scoped triggers are accepted — a staff tap in the
       * console today, a guest tap on the stay surface, and later a door event
       * from Rooms. All three become the same journey command, which is the
       * whole point of ADR-013: a new trigger source plugs in without the
       * journey changing.
       *
       * Confirming arrival is what starts the Alloggiati filing. That coupling
       * lives here rather than inside the command because enqueuing is the
       * worker's job and core must not know the queue exists (ADR-005).
       */
      .post('/jobs/arrival-confirm', async (c) => {
        const body = await c.req.json<{
          propertyId?: string
          reservationId?: string
          userId?: string
        }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const outcome = await applyJourneyCommand({
          propertyId: body.propertyId,
          reservationId: body.reservationId,
          command: { type: 'arrival.confirm' },
          // Named, when a person did it. "Who marked this guest arrived" is a
          // question that gets asked, and `system` would be a small lie.
          ...(body.userId ? { actor: userActor(body.userId) } : {}),
        })

        if (outcome.status === 'applied' || outcome.status === 'no-op') {
          await queue.send(
            'alloggiati.file',
            { propertyId: body.propertyId, reservationId: body.reservationId },
            { singletonKey: `alloggiati:${body.reservationId}` },
          )
        }

        logger.info(
          { reservationId: body.reservationId, outcome: outcome.status },
          'arrival confirmed',
        )

        return c.json({ status: outcome.status })
      })

      /**
       * File this stay now (E2.3).
       *
       * The manual submit the acceptance criterion requires to be always
       * present. Automation that cannot be overridden is automation an owner
       * cannot answer for — and they are the declarant.
       *
       * Safe to press repeatedly: the singleton key collapses duplicates, and
       * the domain refuses to re-file something already submitted.
       */
      .post('/jobs/alloggiati-submit', async (c) => {
        const body = await c.req.json<{ propertyId?: string; reservationId?: string }>()

        if (!body.propertyId || !body.reservationId) {
          return c.json({ error: 'propertyId and reservationId are required' }, 400)
        }

        const id = await queue.send(
          'alloggiati.file',
          { propertyId: body.propertyId, reservationId: body.reservationId },
          { singletonKey: `alloggiati:${body.reservationId}` },
        )

        return c.json({ enqueued: id })
      })

      /**
       * MEMO — SIMULATED PAYMENT SUPPORT. Development and staging only.
       *
       * What the fake checkout page reads to render an amount. A real
       * provider hosts its own page and needs none of this, which is why the
       * route is gated the same way the simulator is.
       */
      .post('/jobs/payment-intent', async (c) => {
        if (!allowSimulation) return c.json({ error: 'not found' }, 404)

        const body = await c.req.json<{ intentId?: string }>()
        if (!body.intentId) return c.json({ error: 'intentId is required' }, 400)

        const simulator = payments as Partial<MockPaymentAdapter>
        if (typeof simulator.peek !== 'function') {
          return c.json({ error: 'the configured payment provider cannot be inspected' }, 409)
        }

        const intent = simulator.peek(body.intentId)
        if (!intent) return c.json({ error: 'unknown intent' }, 404)

        return c.json({
          id: intent.id,
          amountCents: intent.amountCents,
          currency: intent.currency,
          status: intent.status,
          reservationId: intent.reservationId,
          propertyId: intent.propertyId,
        })
      })

      /**
       * ═══════════════════════════════════════════════════════════════════
       *  MEMO — SIMULATED PAYMENT. Development and staging only.
       * ═══════════════════════════════════════════════════════════════════
       *
       * Stands in for a guest entering a card. It asks the mock adapter to move
       * an intent to an outcome, then feeds the resulting signed payload
       * through **the real webhook path** — same parse, same signature check,
       * same idempotency, same jobs. That is the whole point: when a real
       * provider replaces the mock, this route disappears and nothing else
       * changes.
       *
       * Not registered at all when `allowSimulation` is false.
       */
      .post('/jobs/payment-simulate', async (c) => {
        if (!allowSimulation) return c.json({ error: 'not found' }, 404)

        const body = await c.req.json<{
          intentId?: string
          outcome?: 'succeeded' | 'failed' | 'requires_action'
        }>()

        if (!body.intentId) return c.json({ error: 'intentId is required' }, 400)

        const simulator = payments as Partial<MockPaymentAdapter>

        if (typeof simulator.simulate !== 'function') {
          // The configured provider is a real one. Refusing loudly beats
          // pretending to simulate against a provider that would charge a card.
          return c.json({ error: 'the configured payment provider cannot be simulated' }, 409)
        }

        let signed: { payload: string; signature: string }
        try {
          signed = simulator.simulate(body.intentId, body.outcome ?? 'succeeded')
        } catch (cause) {
          return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 404)
        }

        const event = await payments.parseWebhook(signed.payload, signed.signature)
        if (!event) return c.json({ ignored: true })

        const outcome = await dispatch(event)

        logger.info(
          { intentId: body.intentId, chose: body.outcome ?? 'succeeded', outcome: outcome.status },
          'payment simulated — no money moved',
        )

        return c.json({ status: outcome.status })
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
