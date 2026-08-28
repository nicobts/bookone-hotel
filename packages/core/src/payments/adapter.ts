/**
 * The payment port (ADR-010).
 *
 * ## Read this before wiring a real provider
 *
 * **No provider is connected. `MockPaymentAdapter` is the only implementation,
 * and it moves no money.** That is a deliberate staging decision, not an
 * oversight: the interface, the policy engine, the webhook path, the `payments`
 * and `fee_events` rows and the refund flow are all real and exercised, so
 * connecting Stripe is a new class in `packages/adapters` and one registration
 * — not a redesign.
 *
 * Everything the real integration will need is already shaped here:
 *
 *   - amounts in integer cents with an explicit currency
 *   - an intent that can require additional authentication (SCA/3DS), because a
 *     flow that only handles the happy path has to be rebuilt for the one that
 *     matters
 *   - webhooks as the **only** state authority (03 §7.2). The client returning
 *     from a checkout is a hint; the webhook is the fact. Anything that
 *     confirms a reservation from a browser redirect will double-confirm,
 *     under-confirm, or both
 *   - signature verification on the webhook, so an endpoint that confirms
 *     bookings cannot be driven by anyone who can reach it
 *
 * When Stripe lands: `StripePaymentAdapter implements PaymentAdapter`, passing
 * the same contract suite the mock passes (`packages/adapters/src/payments/
 * contract.ts`) before the swap — the ADR-008 discipline, applied to money.
 */

export type PaymentIntentStatus =
  /** Created, not yet paid. */
  | 'requires_payment'
  /** SCA/3DS. The guest has more to do, and the booking is not confirmed. */
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface PaymentIntent {
  /** The provider's id for it. Never a key here — see `payments.external_id`. */
  id: string
  status: PaymentIntentStatus
  amountCents: number
  currency: string
  /** Our reservation id, round-tripped through the provider's metadata. */
  reservationId: string
  propertyId: string
  /** Where the guest completes payment. Null once nothing more is required. */
  checkoutUrl: string | null
  /** Provider-side reason, surfaced on the payment step (E1.3). */
  failureReason?: string
}

export interface CreateIntentInput {
  propertyId: string
  reservationId: string
  amountCents: number
  currency: string
  /**
   * Ask the provider to keep the card for the property's no-show policy.
   * Requires explicit consent copy at the point of capture (E1.3, PRD A4).
   */
  vaultCard: boolean
  /** Where to send the guest afterwards. The webhook still decides the truth. */
  returnUrl: string
}

export interface RefundResult {
  id: string
  amountCents: number
  status: 'succeeded' | 'pending' | 'failed'
  failureReason?: string
}

/**
 * A provider event, already verified and normalised.
 *
 * Deliberately a small closed set rather than the provider's own event
 * vocabulary: the worker should not learn Stripe's names for things, or
 * swapping providers means rewriting the handler as well as the adapter.
 */
export type PaymentEvent =
  | { type: 'payment.succeeded'; intent: PaymentIntent; providerEventId: string }
  | { type: 'payment.failed'; intent: PaymentIntent; providerEventId: string }
  | { type: 'payment.cancelled'; intent: PaymentIntent; providerEventId: string }
  | { type: 'refund.succeeded'; refundId: string; intentId: string; providerEventId: string }

export class PaymentAdapterError extends Error {
  constructor(
    readonly code: 'unavailable' | 'rejected' | 'not_found' | 'unauthorized' | 'invalid_signature',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'PaymentAdapterError'
  }
}

export interface PaymentAdapter {
  /** `mock`, `stripe`, `nexi` — recorded on every `payments` row. */
  readonly provider: string

  /**
   * True when this adapter moves no real money.
   *
   * Read by the booking surface to render the "simulated payment" notice, and
   * asserted at boot in production so a mock cannot be deployed by accident.
   * A flag rather than a name comparison: `provider === 'mock'` scattered
   * through the UI is a check somebody eventually forgets.
   */
  readonly simulated: boolean

  createIntent(input: CreateIntentInput): Promise<PaymentIntent>

  getIntent(propertyId: string, intentId: string): Promise<PaymentIntent | null>

  refund(input: {
    propertyId: string
    intentId: string
    amountCents: number
    reason: string
  }): Promise<RefundResult>

  /**
   * Verifies and parses an inbound webhook.
   *
   * Returns null for an event we do not act on — a provider sends many, and
   * throwing on the uninteresting ones turns normal traffic into alerts.
   * Throws `invalid_signature` when the payload cannot be trusted, which must
   * be a 400 and never a retry.
   */
  parseWebhook(payload: string, signature: string | null): Promise<PaymentEvent | null>

  healthCheck(): Promise<{ healthy: boolean; message?: string; checkedAt: Date }>
}
