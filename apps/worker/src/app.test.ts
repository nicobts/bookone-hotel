import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'

const TOKEN = 'a-token-long-enough-to-pass-the-check'

function build(
  overrides: {
    send?: ReturnType<typeof vi.fn>
    parseWebhook?: ReturnType<typeof vi.fn>
    allowSimulation?: boolean
  } = {},
) {
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
  } as never

  return { app: createApp(deps), send }
}

const authorised = { Authorization: `Bearer ${TOKEN}` }

describe('worker http surface', () => {
  it('reports health', async () => {
    const res = await build().app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok', service: 'worker' })
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
