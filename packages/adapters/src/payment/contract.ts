import { describe, expect, it } from 'vitest'
import { PaymentAdapterError, type PaymentAdapter } from '@bookone/core/payments'

/**
 * The shared `PaymentAdapter` contract.
 *
 * Every implementation runs this same suite. Passing it is the precondition for
 * replacing the mock with a real provider (ADR-010, applying ADR-008's
 * discipline to money) — the swap is not a judgement call about whether the
 * integration "looks right", it is this file going green against it.
 *
 * What belongs here: behaviour the booking and refund paths rely on regardless
 * of who is behind the interface. What does not: anything about a provider's
 * own ids, event names or fixture values.
 *
 * Written as a callable rather than a plain test file so both implementations
 * import the identical assertions. Two copies would diverge, and the copy that
 * diverged would be the real one — which is the one that moves money.
 */
export function describePaymentAdapterContract(
  name: string,
  createAdapter: () => PaymentAdapter | Promise<PaymentAdapter>,
  options: {
    propertyId?: string
    /**
     * Drives an intent to `succeeded` however this implementation can.
     *
     * The mock exposes `simulate`; a real adapter will need a provider test
     * clock or a test card. Absent, the capture-dependent cases are skipped
     * rather than silently passing — a skipped test is visible, a vacuous one
     * is not.
     */
    capture?: (adapter: PaymentAdapter, intentId: string) => Promise<void>
  } = {},
): void {
  const propertyId = options.propertyId ?? 'contract-property'
  const reservationId = 'aa11bb22-cc33-dd44-ee55-ff6677889900'

  const intentInput = {
    propertyId,
    reservationId,
    amountCents: 12_000,
    currency: 'EUR',
    vaultCard: false,
    returnUrl: 'https://example.test/return',
  }

  describe(`PaymentAdapter contract — ${name}`, () => {
    it('names its provider and says whether it is simulated', async () => {
      const adapter = await createAdapter()

      expect(adapter.provider).toBeTruthy()
      // Not optional. Every surface that must warn a guest reads this flag, and
      // an adapter that leaves it undefined reads as falsy — which would render
      // a simulated payment as a real one.
      expect(typeof adapter.simulated).toBe('boolean')
    })

    it('creates an intent the guest can be sent to', async () => {
      const adapter = await createAdapter()
      const intent = await adapter.createIntent(intentInput)

      expect(intent.id).toBeTruthy()
      expect(intent.amountCents).toBe(12_000)
      expect(intent.currency).toBe('EUR')
      // Our ids round-trip through the provider, which is how the webhook knows
      // what it is talking about without us keeping a lookup table.
      expect(intent.reservationId).toBe(reservationId)
      expect(intent.propertyId).toBe(propertyId)
      expect(intent.status).toBe('requires_payment')
      expect(intent.checkoutUrl).toBeTruthy()
    })

    it('does not accept a zero or negative amount', async () => {
      const adapter = await createAdapter()

      // A zero-amount intent would confirm a booking nobody paid for: the
      // webhook cannot tell the difference between "paid nothing" and "paid".
      await expect(adapter.createIntent({ ...intentInput, amountCents: 0 })).rejects.toBeInstanceOf(
        PaymentAdapterError,
      )
    })

    it('reads back an intent it created', async () => {
      const adapter = await createAdapter()
      const created = await adapter.createIntent(intentInput)

      const found = await adapter.getIntent(propertyId, created.id)

      expect(found?.id).toBe(created.id)
    })

    it('will not return an intent belonging to another property', async () => {
      const adapter = await createAdapter()
      const created = await adapter.createIntent(intentInput)

      // The sweep looks intents up by id. Without this, a lost webhook at one
      // property could be resolved using another property's payment.
      expect(await adapter.getIntent('someone-else', created.id)).toBeNull()
    })

    it('returns null rather than throwing for an unknown intent', async () => {
      const adapter = await createAdapter()

      expect(await adapter.getIntent(propertyId, 'pi_does_not_exist')).toBeNull()
    })

    it('refuses a webhook with no signature', async () => {
      const adapter = await createAdapter()

      // This endpoint confirms bookings. Unsigned means unauthenticated, and an
      // unauthenticated caller must not be able to mark a stay as paid.
      await expect(adapter.parseWebhook('{}', null)).rejects.toMatchObject({
        code: 'invalid_signature',
        retryable: false,
      })
    })

    it('refuses a webhook whose signature does not match the body', async () => {
      const adapter = await createAdapter()

      await expect(
        adapter.parseWebhook('{"type":"payment.succeeded"}', 'not-a-signature'),
      ).rejects.toMatchObject({ code: 'invalid_signature' })
    })

    it('reports its health without throwing', async () => {
      const adapter = await createAdapter()
      const health = await adapter.healthCheck()

      expect(typeof health.healthy).toBe('boolean')
      expect(health.checkedAt).toBeInstanceOf(Date)
    })

    const capture = options.capture

    it.skipIf(!capture)('refunds no more than was captured', async () => {
      const adapter = await createAdapter()
      const intent = await adapter.createIntent(intentInput)
      await capture!(adapter, intent.id)

      await adapter.refund({
        propertyId,
        intentId: intent.id,
        amountCents: 8_000,
        reason: 'policy',
      })

      // The provider enforces this and so must every implementation, or the
      // policy engine's arithmetic is the only thing standing between us and
      // refunding a guest more than they paid.
      await expect(
        adapter.refund({ propertyId, intentId: intent.id, amountCents: 8_000, reason: 'policy' }),
      ).rejects.toBeInstanceOf(PaymentAdapterError)
    })

    it.skipIf(!capture)('will not refund an intent that was never captured', async () => {
      const adapter = await createAdapter()
      const intent = await adapter.createIntent(intentInput)

      await expect(
        adapter.refund({ propertyId, intentId: intent.id, amountCents: 1_000, reason: 'policy' }),
      ).rejects.toBeInstanceOf(PaymentAdapterError)
    })

    it.skipIf(!capture)('will not refund another property’s intent', async () => {
      const adapter = await createAdapter()
      const intent = await adapter.createIntent(intentInput)
      await capture!(adapter, intent.id)

      await expect(
        adapter.refund({
          propertyId: 'someone-else',
          intentId: intent.id,
          amountCents: 1_000,
          reason: 'policy',
        }),
      ).rejects.toBeInstanceOf(PaymentAdapterError)
    })
  })
}
