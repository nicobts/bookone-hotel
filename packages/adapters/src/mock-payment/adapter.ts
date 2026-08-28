import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  PaymentAdapterError,
  type CreateIntentInput,
  type PaymentAdapter,
  type PaymentEvent,
  type PaymentIntent,
  type RefundResult,
} from '@bookone/core/payments'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MEMO — NO REAL MONEY MOVES HERE. NO PAYMENT PROVIDER IS CONNECTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is a stand-in for Stripe (ADR-010), deliberately staged the same way the
 * PMS connector was (ADR-008): build against the interface, prove the whole
 * path, swap the implementation when the commercial side is ready.
 *
 * **What is real** — and this is the point of doing it this way:
 *
 *   - the `PaymentAdapter` interface, unchanged when Stripe arrives
 *   - the policy engine that decides the deposit and the refund
 *   - `payments` and `fee_events` rows, and the reservation lifecycle
 *   - the webhook path, **including signature verification**, as the only
 *     authority on whether a booking is paid (03 §7.2)
 *   - redelivery, replay and the sweep that catches a lost webhook
 *
 * **What is fake:** the card form, the authorisation, and the money. A guest
 * "paying" here chooses an outcome from a button.
 *
 * **Before this can be replaced, someone must:** create the Stripe account and
 * Connect Standard onboarding (04 §0 item 6), have the commercialista session
 * on the fee flow, then write `StripePaymentAdapter` and make it pass
 * `describePaymentAdapterContract` — the same suite this class passes — before
 * the swap.
 *
 * `simulated` is true, and the worker refuses to boot with a simulated adapter
 * when `NODE_ENV=production`. That check is the thing standing between this
 * file and a real guest's booking.
 */

export interface MockPaymentFailure {
  on: 'createIntent' | 'refund' | 'any'
  code: 'unavailable' | 'rejected' | 'unauthorized'
  /** Fail this many times, then succeed. Counted, not random — see the PMS mock. */
  times: number
}

export interface MockPaymentOptions {
  /** Shared secret for webhook signatures. Stripe has one; so does this. */
  webhookSecret?: string
  failures?: MockPaymentFailure[]
  /** Where the simulated checkout page lives, for `checkoutUrl`. */
  checkoutBaseUrl?: string
  now?: () => Date
}

const RETRYABLE = {
  unavailable: true,
  rejected: false,
  unauthorized: false,
} as const

export class MockPaymentAdapter implements PaymentAdapter {
  readonly provider = 'mock'

  /** Read by the UI to render the simulated-payment notice. Never false here. */
  readonly simulated = true

  private readonly intents = new Map<string, PaymentIntent>()
  private readonly refunds = new Map<string, RefundResult[]>()
  private readonly failures: MockPaymentFailure[]
  private readonly webhookSecret: string
  private readonly checkoutBaseUrl: string
  private readonly now: () => Date

  /** Sequential, like a provider assigning its own ids — never derived from ours. */
  private sequence = 0

  /**
   * Per-instance, so two adapters never issue the same id.
   *
   * Sequential numbering alone was not enough: a second instance restarts at 1
   * and reissues ids the first already used, which a real provider never does.
   * Found by two tests sharing a database and colliding on
   * `external_refs_property_system_entity` — a fidelity gap in the mock, not a
   * bug in the code under test, and exactly the kind the mock exists to avoid
   * hiding.
   */
  private readonly instance = randomUUID().slice(0, 8)

  constructor(options: MockPaymentOptions = {}) {
    this.failures = (options.failures ?? []).map((failure) => ({ ...failure }))
    this.webhookSecret = options.webhookSecret ?? 'mock-webhook-secret'
    this.checkoutBaseUrl = options.checkoutBaseUrl ?? ''
    this.now = options.now ?? (() => new Date())
  }

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    this.gate('createIntent')

    if (input.amountCents <= 0) {
      throw new PaymentAdapterError('rejected', 'amount must be positive', false)
    }

    this.sequence += 1
    const id = `pi_mock_${this.instance}_${String(this.sequence).padStart(4, '0')}`

    const intent: PaymentIntent = {
      id,
      status: 'requires_payment',
      amountCents: input.amountCents,
      currency: input.currency,
      reservationId: input.reservationId,
      propertyId: input.propertyId,
      // The simulated checkout page. A real provider returns its own hosted
      // URL here and the shape of the flow is identical — including carrying
      // the return address, which is why it is a parameter and not a constant.
      checkoutUrl: `${this.checkoutBaseUrl}/pay/${id}?return=${encodeURIComponent(
        returnPath(input.returnUrl),
      )}`,
    }

    this.intents.set(id, intent)

    return Promise.resolve({ ...intent })
  }

  getIntent(propertyId: string, intentId: string): Promise<PaymentIntent | null> {
    const intent = this.intents.get(intentId)

    // Scoped, like every other lookup in this codebase. A provider would scope
    // by connected account; not doing it here would let the sweep read another
    // property's intent and act on it.
    if (!intent || intent.propertyId !== propertyId) return Promise.resolve(null)

    return Promise.resolve({ ...intent })
  }

  async refund(input: {
    propertyId: string
    intentId: string
    amountCents: number
    reason: string
  }): Promise<RefundResult> {
    this.gate('refund')

    const intent = this.intents.get(input.intentId)
    if (!intent || intent.propertyId !== input.propertyId) {
      throw new PaymentAdapterError('not_found', `unknown intent ${input.intentId}`, false)
    }

    if (intent.status !== 'succeeded') {
      throw new PaymentAdapterError('rejected', `intent is ${intent.status}`, false)
    }

    const already = (this.refunds.get(input.intentId) ?? [])
      .filter((refund) => refund.status !== 'failed')
      .reduce((sum, refund) => sum + refund.amountCents, 0)

    // A real provider enforces this and so must the mock, or the contract test
    // for it passes against an adapter that would let us refund twice.
    if (already + input.amountCents > intent.amountCents) {
      throw new PaymentAdapterError('rejected', 'refund exceeds the amount captured', false)
    }

    const result: RefundResult = {
      id: `re_mock_${randomUUID().slice(0, 8)}`,
      amountCents: input.amountCents,
      status: 'succeeded',
    }

    this.refunds.set(input.intentId, [...(this.refunds.get(input.intentId) ?? []), result])

    return result
  }

  // `async`, and that is load-bearing rather than stylistic: this method
  // throws on an untrusted payload, and a synchronous throw from a method
  // typed as returning a promise escapes every caller's `.catch` and takes the
  // process with it. Caught by the contract suite, which asserts a *rejection*.
  async parseWebhook(payload: string, signature: string | null): Promise<PaymentEvent | null> {
    if (!signature || !this.verify(payload, signature)) {
      // Never retryable. A payload we cannot trust does not become trustworthy
      // on a second attempt, and retrying one is how a replay attack gets a
      // second chance.
      throw new PaymentAdapterError('invalid_signature', 'webhook signature does not match', false)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      throw new PaymentAdapterError('rejected', 'webhook payload is not json', false)
    }

    const body = parsed as { type?: string; intentId?: string; eventId?: string }
    if (!body.type || !body.intentId || !body.eventId) return null

    const intent = this.intents.get(body.intentId)
    if (!intent) return null

    switch (body.type) {
      case 'payment.succeeded':
        return { type: 'payment.succeeded', intent: { ...intent }, providerEventId: body.eventId }
      case 'payment.failed':
        return { type: 'payment.failed', intent: { ...intent }, providerEventId: body.eventId }
      case 'payment.cancelled':
        return { type: 'payment.cancelled', intent: { ...intent }, providerEventId: body.eventId }
      default:
        // A provider sends many events we do not act on. Ignoring them quietly
        // is correct; throwing turns ordinary traffic into alerts.
        return null
    }
  }

  healthCheck(): Promise<{ healthy: boolean; message?: string; checkedAt: Date }> {
    return Promise.resolve({
      healthy: true,
      message: 'simulated provider — no real money moves',
      checkedAt: this.now(),
    })
  }

  // -------------------------------------------------------------------------
  // Simulation surface — not part of `PaymentAdapter`
  // -------------------------------------------------------------------------

  /**
   * What the fake checkout page calls when a guest picks an outcome.
   *
   * Deliberately **not** on the interface: no production code path may reach
   * it, and a method the port does not declare cannot be called by anything
   * holding a `PaymentAdapter`. The worker downcasts once, in one place, behind
   * an environment check.
   *
   * Returns the signed webhook body, because the whole point is that the state
   * change travels the same road a real provider's would.
   */
  simulate(
    intentId: string,
    outcome: 'succeeded' | 'failed' | 'requires_action',
    failureReason?: string,
  ): { payload: string; signature: string } {
    const intent = this.intents.get(intentId)
    if (!intent) throw new PaymentAdapterError('not_found', `unknown intent ${intentId}`, false)

    intent.status = outcome
    intent.checkoutUrl = outcome === 'succeeded' ? null : intent.checkoutUrl
    if (failureReason) intent.failureReason = failureReason

    const payload = JSON.stringify({
      type:
        outcome === 'succeeded'
          ? 'payment.succeeded'
          : outcome === 'failed'
            ? 'payment.failed'
            : 'payment.pending',
      intentId,
      // A provider event id, so redelivery of the same event is detectable.
      eventId: `evt_mock_${randomUUID().slice(0, 12)}`,
      at: this.now().toISOString(),
    })

    return { payload, signature: this.sign(payload) }
  }

  /**
   * Reads an intent without knowing its property.
   *
   * Only the simulated checkout page needs this — it is reached by intent id
   * alone, because a provider-hosted page would be too. Deliberately **not** on
   * the port: the production lookup is `getIntent`, which is property-scoped,
   * and adding an unscoped read to the interface would make that scoping
   * optional for every future implementation.
   */
  peek(intentId: string): PaymentIntent | null {
    const intent = this.intents.get(intentId)

    return intent ? { ...intent } : null
  }

  sign(payload: string): string {
    return createHmac('sha256', this.webhookSecret).update(payload).digest('hex')
  }

  private verify(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload), 'utf8')
    const presented = Buffer.from(signature, 'utf8')

    // Length-checked first: `timingSafeEqual` throws on a mismatch, and the
    // throw is itself a length oracle.
    if (expected.length !== presented.length) return false

    return timingSafeEqual(expected, presented)
  }

  private gate(operation: MockPaymentFailure['on']): void {
    const failure = this.failures.find(
      (candidate) => (candidate.on === operation || candidate.on === 'any') && candidate.times > 0,
    )

    if (!failure) return

    failure.times -= 1

    throw new PaymentAdapterError(
      failure.code,
      `injected ${failure.code} on ${operation}`,
      RETRYABLE[failure.code],
    )
  }
}

/**
 * The path part of a return URL.
 *
 * The simulated checkout only ever redirects to a relative path, so an absolute
 * one is reduced here rather than trusted there — a checkout page that will
 * redirect anywhere it is told is an open redirect, mock or not.
 */
function returnPath(url: string): string {
  try {
    const parsed = new URL(url)

    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url.startsWith('/') ? url : '/'
  }
}
