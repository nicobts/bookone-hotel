import { describe, expect, it, vi } from 'vitest'
import { FEATURES, PHASE0_FEATURES } from '@bookone/core/onboarding'
import { twilioSignature } from '@bookone/adapters/twilio'
import { createApp } from './app'
import { ROUTE_FEATURE } from './features'

const TOKEN = 'a-token-long-enough-to-pass-the-check'

function build(
  overrides: {
    send?: ReturnType<typeof vi.fn>
    parseWebhook?: ReturnType<typeof vi.fn>
    allowSimulation?: boolean
    webhookRateLimit?: number
    twilio?: { authToken: string; publicBaseUrl: string }
    routeInbound?: ReturnType<typeof vi.fn>
    /** Features property `p1` has. Every feature unless a test says otherwise. */
    features?: readonly string[]
  } = {},
) {
  const enabled = new Set<string>(overrides.features ?? FEATURES)
  const send = overrides.send ?? vi.fn(async () => 'job-1')

  /** Stand-ins: these tests exercise routing and the guard, not the queue. */
  const deps = {
    queue: {
      send,
      work: async () => undefined,
      schedule: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
    },
    adapter: {
      system: 'mock',
      healthCheck: async () => ({ healthy: true, checkedAt: new Date() }),
    },
    payments: {
      provider: 'mock',
      simulated: true,
      healthCheck: async () => ({ healthy: true, checkedAt: new Date() }),
      parseWebhook:
        overrides.parseWebhook ??
        vi.fn(async () => {
          throw Object.assign(new Error('bad signature'), {
            name: 'PaymentAdapterError',
            code: 'invalid_signature',
          })
        }),
    },
    logger: { info: () => undefined, warn: () => undefined },
    internalToken: TOKEN,
    appUrl: 'http://localhost:3000',
    allowSimulation: overrides.allowSimulation ?? true,
    featureCheck: () => async (_propertyId: string, feature: string) => enabled.has(feature),
    webhookRateLimit: overrides.webhookRateLimit ?? 120,
    ...(overrides.twilio ? { twilio: overrides.twilio } : {}),
    ...(overrides.routeInbound ? { routeInbound: overrides.routeInbound } : {}),
  } as never

  return { app: createApp(deps), send }
}

const authorised = { Authorization: `Bearer ${TOKEN}` }

describe('worker http surface', () => {
  it('reports health', async () => {
    const res = await build().app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok', service: 'api' })
  })

  it('404s an unknown route', async () => {
    expect((await build().app.request('/nope')).status).toBe(404)
  })

  it('leaves health unauthenticated', async () => {
    // Deliberate: a health check that needs a secret is a health check the
    // platform's own probes cannot make.
    expect((await build().app.request('/health')).status).toBe(200)
  })
})

describe('/jobs guard', () => {
  /**
   * The negative control for this whole surface.
   *
   * These endpoints enqueue work against any property id in the body, and the
   * booking page — a public page — is now one of their callers. Without the
   * guard, anyone who can route to this process can fill a hotel's PMS with
   * reflections.
   */
  it.each([
    ['no header', {}],
    ['empty bearer', { Authorization: 'Bearer ' }],
    ['wrong token', { Authorization: 'Bearer not-the-token-but-long-enough' }],
    ['raw token without the scheme', { Authorization: TOKEN }],
  ])('rejects %s and enqueues nothing', async (_label, headers) => {
    const { app, send } = build()

    const res = await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ propertyId: 'p1', reservationId: 'r1' }),
    })

    expect(res.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('says nothing about why it refused', async () => {
    const { app } = build()

    const res = await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer nope' },
      body: JSON.stringify({ propertyId: 'p1', reservationId: 'r1' }),
    })

    // "Wrong token" and "no token" are the same answer. Anything more helpful
    // is help for the wrong person.
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
  })
})

describe('POST /jobs/booking-confirmed', () => {
  it('enqueues the reflection and the confirmation together', async () => {
    const { app, send } = build()

    const res = await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorised },
      body: JSON.stringify({ propertyId: 'p1', reservationId: 'r1', notificationId: 'n1' }),
    })

    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(
      'reservation.reflect',
      { propertyId: 'p1', reservationId: 'r1' },
      { singletonKey: 'reflect:r1' },
    )
    expect(send).toHaveBeenCalledWith(
      'notification.send',
      { propertyId: 'p1', notificationId: 'n1' },
      { singletonKey: 'notify:n1' },
    )
  })

  it('still reflects when the confirmation was already queued by an earlier run', async () => {
    const { app, send } = build()

    await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorised },
      body: JSON.stringify({ propertyId: 'p1', reservationId: 'r1' }),
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('reservation.reflect', expect.anything(), expect.anything())
  })

  it('rejects an incomplete body before enqueuing anything', async () => {
    const { app, send } = build()

    const res = await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorised },
      body: JSON.stringify({ propertyId: 'p1' }),
    })

    expect(res.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('POST /webhooks/payments', () => {
  /**
   * This endpoint can mark a booking as paid, and it deliberately sits outside
   * the bearer-token guard — a payment provider cannot present our internal
   * secret. The payload signature is therefore the *only* authentication, so
   * these are the tests that matter most on the whole surface.
   */
  it('is reachable without the internal token, by design', async () => {
    const { app } = build()

    const res = await app.request('/webhooks/payments', {
      method: 'POST',
      body: '{}',
    })

    // 400 from the signature check, not 401 from the guard. A 401 here would
    // mean a real provider could never deliver anything.
    expect(res.status).toBe(400)
  })

  it('rejects an unsigned payload with 400, never 5xx', async () => {
    const { app } = build()

    const res = await app.request('/webhooks/payments', {
      method: 'POST',
      headers: { 'x-payment-signature': 'nope' },
      body: '{"type":"payment.succeeded"}',
    })

    // 400 and not 500: a signature that does not match will not match on the
    // retry either, and a 5xx invites the provider to retry all day.
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'invalid webhook' })
  })

  it('acknowledges an event it does not act on', async () => {
    const { app, send } = build({ parseWebhook: vi.fn(async () => null) })

    const res = await app.request('/webhooks/payments', {
      method: 'POST',
      headers: { 'x-payment-signature': 'ok' },
      body: '{"type":"provider.noise"}',
    })

    // A provider sends many events. Answering 2xx and doing nothing is correct;
    // a non-2xx would make it redeliver noise forever.
    expect(res.status).toBe(200)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('POST /jobs/payment-simulate', () => {
  it('does not exist when simulation is disabled', async () => {
    const { app } = build({ allowSimulation: false })

    const res = await app.request('/jobs/payment-simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorised },
      body: JSON.stringify({ intentId: 'pi_mock_000001' }),
    })

    // 404, not 403. In production this route is never registered — there is
    // nothing to probe and no path from a request to a fabricated capture.
    expect(res.status).toBe(404)
  })

  it('still requires the internal token when it does exist', async () => {
    const { app } = build({ allowSimulation: true })

    const res = await app.request('/jobs/payment-simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentId: 'pi_mock_000001' }),
    })

    expect(res.status).toBe(401)
  })
})

describe('the route table', () => {
  it('registers no path twice for the same method', () => {
    /*
     * Hono matches the first route it registered for a path, so a duplicate is
     * silent: the second handler never runs and the caller gets a plausible
     * 200 from the wrong one.
     *
     * This is not hypothetical. Sprint 7 added a departure endpoint at
     * `/jobs/checkout`, which Sprint 4 had already taken for starting a
     * *payment* — so a guest checking out received a payment-intent response,
     * the button appeared to work, and nothing was recorded. It was found by
     * reading the database after clicking, and this test is what makes the next
     * one fail loudly instead.
     */
    const { app } = build()

    const seen = new Set<string>()
    const duplicates: string[] = []

    for (const route of app.routes) {
      const key = `${route.method} ${route.path}`

      // Middleware legitimately registers `ALL` across a prefix; only concrete
      // handlers are being checked for collision here.
      if (route.method === 'ALL') continue

      if (seen.has(key)) duplicates.push(key)
      seen.add(key)
    }

    expect(duplicates).toEqual([])
  })
})

describe('the feature gate (ADR-019)', () => {
  /** Every concrete `/jobs/*` route in the table. */
  function jobRoutes(): string[] {
    const { app } = build()
    return [
      ...new Set(
        app.routes
          .filter((r) => r.method === 'POST' && r.path.startsWith('/jobs/'))
          .map((r) => r.path),
      ),
    ].sort()
  }

  /**
   * Which routes do anything for a property with `features`.
   *
   * The body names the property and nothing else, so a route that gets past
   * the gate answers its own 400 (or enqueues, for the one that needs only a
   * property) without touching a database. 404 means the gate refused.
   */
  async function reachable(features: readonly string[]): Promise<string[]> {
    const open: string[] = []

    for (const path of jobRoutes()) {
      const { app } = build({ features })
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authorised },
        body: JSON.stringify({ propertyId: 'p1' }),
      })

      if (res.status !== 404) open.push(path)
    }

    return open
  }

  it('classifies every internal route', () => {
    // A route nobody classified is refused by the middleware — this makes the
    // omission a failing test instead of a mysterious 404 in production.
    expect(jobRoutes().filter((path) => !(path in ROUTE_FEATURE))).toEqual([])
    expect(Object.keys(ROUTE_FEATURE).sort()).toEqual(jobRoutes())
  })

  it('with every feature off, only the core routes answer', async () => {
    expect(await reachable([])).toEqual([
      '/jobs/arrival-confirm',
      '/jobs/cancel',
      '/jobs/cancellation-quote',
      '/jobs/depart',
      '/jobs/payment-intent',
      '/jobs/payment-simulate',
      '/jobs/privacy-erase',
      '/jobs/retention-sweep',
    ])
  })

  it('with the Phase 0 set, exactly the Phase 0 surface answers', async () => {
    expect(await reachable(PHASE0_FEATURES)).toEqual([
      '/jobs/agent-preview',
      '/jobs/arrival-confirm',
      '/jobs/cancel',
      '/jobs/cancellation-quote',
      '/jobs/checkout',
      '/jobs/depart',
      '/jobs/guest-message',
      '/jobs/owner-message',
      '/jobs/payment-intent',
      '/jobs/payment-simulate',
      '/jobs/privacy-erase',
      '/jobs/retention-sweep',
    ])
  })

  it('refuses a gated route with the same answer as an unknown one, and enqueues nothing', async () => {
    const { app, send } = build({ features: [] })

    const res = await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorised },
      body: JSON.stringify({ propertyId: 'p1', reservationId: 'r1', notificationId: 'n1' }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'not found' })
    expect(send).not.toHaveBeenCalled()
  })

  it('checks after authentication, so the gate leaks nothing to an unauthenticated caller', async () => {
    const { app } = build({ features: [] })

    const res = await app.request('/jobs/booking-confirmed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId: 'p1', reservationId: 'r1' }),
    })

    expect(res.status).toBe(401)
  })
})

describe('webhook ingress guards (ADR-032)', () => {
  it('rate-limits a flood per client before the signature check', async () => {
    const parseWebhook = vi.fn(async () => {
      throw Object.assign(new Error('bad signature'), {
        name: 'PaymentAdapterError',
        code: 'invalid_signature',
      })
    })
    const { app } = build({ webhookRateLimit: 3, parseWebhook })
    const post = () => app.request('/webhooks/payments', { method: 'POST', body: '{}' })

    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(400)

    const limited = await post()
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    // The fourth never reached the HMAC.
    expect(parseWebhook).toHaveBeenCalledTimes(3)
  })

  it('refuses an oversized payload with 413', async () => {
    const { app } = build()
    const res = await app.request('/webhooks/payments', {
      method: 'POST',
      headers: { 'content-length': String(300 * 1024) },
      body: 'x'.repeat(300 * 1024),
    })
    expect(res.status).toBe(413)
  })

  it('leaves the internal surface alone', async () => {
    const { app } = build({ webhookRateLimit: 1 })
    for (let i = 0; i < 3; i++) expect((await app.request('/health')).status).toBe(200)
  })
})

describe('Twilio webhooks (ADR-035)', () => {
  const twilio = { authToken: 'twilio-token', publicBaseUrl: 'https://api.example.test/' }
  const SID = 'SM' + 'c'.repeat(32)
  const inbound = {
    MessageSid: SID,
    From: 'whatsapp:+393331234567',
    To: 'whatsapp:+390400000000',
    Body: 'A che ora è la colazione?',
  }

  function post(
    app: ReturnType<typeof build>['app'],
    path: string,
    params: Record<string, string>,
    signature?: string,
  ) {
    return app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature':
          signature ?? twilioSignature(`https://api.example.test${path}`, params, twilio.authToken),
      },
      body: new URLSearchParams(params).toString(),
    })
  }

  it('does not exist when Twilio is not configured', async () => {
    const { app } = build()
    expect((await post(app, '/webhooks/twilio/inbound', inbound)).status).toBe(404)
  })

  it('refuses a bad signature before routing anything', async () => {
    const routeInbound = vi.fn()
    const { app, send } = build({ twilio, routeInbound })
    const res = await post(app, '/webhooks/twilio/inbound', inbound, 'forged')
    expect(res.status).toBe(403)
    expect(routeInbound).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('puts a guest message into the concierge turn and purges Twilio’s copy', async () => {
    const routeInbound = vi.fn(async () => ({
      kind: 'guest',
      propertyId: 'p1',
      reservationId: 'r1',
      threadId: 't1',
      messageId: 'm1',
      locale: 'it',
    }))
    const { app, send } = build({ twilio, routeInbound })

    const res = await post(app, '/webhooks/twilio/inbound', inbound)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<Response/>')
    expect(routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        provider: 'twilio',
        providerMessageId: SID,
        from: '+393331234567',
        to: '+390400000000',
      }),
    )
    const jobs = send.mock.calls.map((call) => call[0])
    expect(jobs).toEqual(['concierge.reply', 'channel.purge'])
    expect(send.mock.calls[0]![1]).toMatchObject({ threadId: 't1', message: inbound.Body })
  })

  it('sends the owner to the owner agent and a stranger to the fixed reply', async () => {
    const owner = build({
      twilio,
      routeInbound: vi.fn(async () => ({
        kind: 'owner',
        propertyId: 'p1',
        phone: '+393331234567',
        locale: 'it',
      })),
    })
    await post(owner.app, '/webhooks/twilio/inbound', inbound)
    expect(owner.send.mock.calls.map((call) => call[0])).toEqual(['owner.message', 'channel.purge'])

    const stranger = build({
      twilio,
      routeInbound: vi.fn(async () => ({ kind: 'unknown', propertyId: 'p1', locale: 'it' })),
    })
    await post(stranger.app, '/webhooks/twilio/inbound', inbound)
    expect(stranger.send.mock.calls.map((call) => call[0])).toEqual([
      'channel.unmatched',
      'channel.purge',
    ])
  })

  it('answers a redelivery or a switched-off channel with 200 and no work but the purge', async () => {
    for (const kind of ['duplicate', 'channel-off', 'no-property']) {
      const { app, send } = build({
        twilio,
        routeInbound: vi.fn(async () => ({ kind, propertyId: 'p1' })),
      })
      expect((await post(app, '/webhooks/twilio/inbound', inbound)).status).toBe(200)
      expect(send.mock.calls.map((call) => call[0])).toEqual(['channel.purge'])
    }
  })

  it('purges a sent message once it reaches a final state', async () => {
    const { app, send } = build({ twilio })
    await post(app, '/webhooks/twilio/status', { MessageSid: SID, MessageStatus: 'sent' })
    expect(send).not.toHaveBeenCalled()

    const res = await post(app, '/webhooks/twilio/status', {
      MessageSid: SID,
      MessageStatus: 'delivered',
    })
    expect(res.status).toBe(204)
    expect(send).toHaveBeenCalledWith(
      'channel.purge',
      { providerMessageId: SID },
      { singletonKey: `purge:${SID}` },
    )
  })
})
