import {
  PaymentAdapterError,
  type CreateIntentInput,
  type PaymentAdapter,
  type PaymentEvent,
  type PaymentIntent,
  type RefundResult,
} from '../../../payments/adapter'

/**
 * A payment provider stand-in, local to core's tests.
 *
 * Local rather than importing `MockPaymentAdapter` from `@bookone/adapters`,
 * because that package depends on this one and the import would close a build
 * cycle — the same lesson the reflection tests learned. The rule it enforces is
 * a good one: **core is tested against its ports, never against an
 * implementation of them.**
 *
 * It deliberately does *not* implement signature verification beyond the
 * minimum the port demands. Verifying a webhook is the adapter's
 * responsibility and is covered where it lives, by the shared contract suite
 * every implementation runs. Duplicating it here would test the copy.
 */
export class FakePaymentAdapter implements PaymentAdapter {
  readonly provider = 'fake'
  readonly simulated = true

  private readonly intents = new Map<string, PaymentIntent>()
  private readonly refunded = new Map<string, number>()
  private sequence = 0

  /** Set to make the next refund throw, for the refund-failure path. */
  refundShouldFail = false

  createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    if (input.amountCents <= 0) {
      throw new PaymentAdapterError('rejected', 'amount must be positive', false)
    }

    this.sequence += 1
    // Unique per instance as well as per call: a provider never reissues an id,
    // and two adapters sharing a database found that out the hard way.
    const id = `pi_fake_${Math.random().toString(36).slice(2, 8)}_${this.sequence}`

    const intent: PaymentIntent = {
      id,
      status: 'requires_payment',
      amountCents: input.amountCents,
      currency: input.currency,
      reservationId: input.reservationId,
      propertyId: input.propertyId,
      checkoutUrl: `https://fake.test/pay/${id}`,
    }

    this.intents.set(id, intent)

    return Promise.resolve({ ...intent })
  }

  getIntent(propertyId: string, intentId: string): Promise<PaymentIntent | null> {
    const intent = this.intents.get(intentId)
    if (!intent || intent.propertyId !== propertyId) return Promise.resolve(null)

    return Promise.resolve({ ...intent })
  }

  refund(input: {
    propertyId: string
    intentId: string
    amountCents: number
    reason: string
  }): Promise<RefundResult> {
    if (this.refundShouldFail) {
      throw new PaymentAdapterError('unavailable', 'injected refund failure', true)
    }

    const intent = this.intents.get(input.intentId)
    if (!intent || intent.propertyId !== input.propertyId) {
      throw new PaymentAdapterError('not_found', 'unknown intent', false)
    }
    if (intent.status !== 'succeeded') {
      throw new PaymentAdapterError('rejected', `intent is ${intent.status}`, false)
    }

    const already = this.refunded.get(input.intentId) ?? 0
    if (already + input.amountCents > intent.amountCents) {
      throw new PaymentAdapterError('rejected', 'refund exceeds the amount captured', false)
    }

    this.refunded.set(input.intentId, already + input.amountCents)

    return Promise.resolve({
      // Unique per instance, for the same reason intent ids are: a provider
      // never reissues an id, and two adapters sharing a database collided on
      // `external_refs_property_system_entity` when this was derived from a
      // per-instance counter.
      id: `re_fake_${Math.random().toString(36).slice(2, 10)}`,
      amountCents: input.amountCents,
      status: 'succeeded',
    })
  }

  parseWebhook(): Promise<PaymentEvent | null> {
    // Core never parses a webhook — the worker does, through the adapter. Tests
    // build the already-verified event and call `applyPaymentEvent` directly,
    // which is exactly the boundary the real code has.
    throw new PaymentAdapterError('invalid_signature', 'not used in core tests', false)
  }

  healthCheck(): Promise<{ healthy: boolean; checkedAt: Date }> {
    return Promise.resolve({ healthy: true, checkedAt: new Date() })
  }

  /** What the provider does when the guest pays. Not part of the port. */
  settle(intentId: string): PaymentEvent {
    const intent = this.intents.get(intentId)
    if (!intent) throw new Error(`unknown intent ${intentId}`)

    intent.status = 'succeeded'

    return {
      type: 'payment.succeeded',
      intent: { ...intent },
      providerEventId: `evt_fake_${intentId}_${Math.random().toString(36).slice(2, 8)}`,
    }
  }

  /** A declined card. */
  decline(intentId: string, reason = 'card_declined'): PaymentEvent {
    const intent = this.intents.get(intentId)
    if (!intent) throw new Error(`unknown intent ${intentId}`)

    intent.status = 'failed'
    intent.failureReason = reason

    return {
      type: 'payment.failed',
      intent: { ...intent },
      providerEventId: `evt_fake_${intentId}_fail`,
    }
  }
}
