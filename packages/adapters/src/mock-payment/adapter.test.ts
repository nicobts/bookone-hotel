import { describe, expect, it } from 'vitest'
import { MockPaymentAdapter } from './adapter'
import { describePaymentAdapterContract } from '../payment/contract'

/**
 * The mock runs the shared contract. When a real provider is written it runs
 * exactly this, and passing is the precondition for the swap (ADR-010).
 */
describePaymentAdapterContract('MockPaymentAdapter', () => new MockPaymentAdapter(), {
  capture: (adapter, intentId) => {
    // The mock's own simulation hook, deliberately absent from the port. A real
    // adapter substitutes a provider test clock here.
    ;(adapter as MockPaymentAdapter).simulate(intentId, 'succeeded')
    return Promise.resolve()
  },
})

describe('MockPaymentAdapter — simulation behaviour', () => {
  const input = {
    propertyId: 'p1',
    reservationId: 'r1',
    amountCents: 10_000,
    currency: 'EUR',
    vaultCard: false,
    returnUrl: 'https://example.test/return',
  }

  it('declares itself simulated', () => {
    // The one property the whole staging decision rests on. If this were ever
    // false, the booking surface would stop warning the guest.
    expect(new MockPaymentAdapter().simulated).toBe(true)
  })

  it('signs a webhook the adapter itself accepts', async () => {
    const adapter = new MockPaymentAdapter()
    const intent = await adapter.createIntent(input)

    const { payload, signature } = adapter.simulate(intent.id, 'succeeded')
    const event = await adapter.parseWebhook(payload, signature)

    expect(event).toMatchObject({ type: 'payment.succeeded' })
  })

  it('rejects a payload edited after signing', async () => {
    const adapter = new MockPaymentAdapter()
    const intent = await adapter.createIntent(input)
    const { payload, signature } = adapter.simulate(intent.id, 'succeeded')

    // The negative control for the signature check. Without it the endpoint
    // that confirms bookings would take anyone's word for it.
    const tampered = payload.replace('payment.succeeded', 'payment.failed')

    await expect(adapter.parseWebhook(tampered, signature)).rejects.toMatchObject({
      code: 'invalid_signature',
    })
  })

  it('gives every event its own id, so redelivery is detectable', async () => {
    const adapter = new MockPaymentAdapter()
    const intent = await adapter.createIntent(input)

    const first = JSON.parse(adapter.simulate(intent.id, 'succeeded').payload) as {
      eventId: string
    }
    const second = JSON.parse(adapter.simulate(intent.id, 'succeeded').payload) as {
      eventId: string
    }

    expect(first.eventId).not.toBe(second.eventId)
  })

  it('fails a counted number of times, then succeeds', async () => {
    const adapter = new MockPaymentAdapter({
      failures: [{ on: 'createIntent', code: 'unavailable', times: 2 }],
    })

    await expect(adapter.createIntent(input)).rejects.toMatchObject({ retryable: true })
    await expect(adapter.createIntent(input)).rejects.toMatchObject({ retryable: true })

    // Counted rather than random: "fails twice then succeeds" is a scenario a
    // retry loop can be proven against; "fails 30% of the time" is a coin toss
    // that eventually passes a broken one.
    await expect(adapter.createIntent(input)).resolves.toMatchObject({
      status: 'requires_payment',
    })
  })

  it('marks a rejection as not retryable', async () => {
    const adapter = new MockPaymentAdapter({
      failures: [{ on: 'createIntent', code: 'rejected', times: 1 }],
    })

    await expect(adapter.createIntent(input)).rejects.toMatchObject({ retryable: false })
  })
})
