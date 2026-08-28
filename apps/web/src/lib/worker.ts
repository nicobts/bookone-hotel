import 'server-only'

/**
 * Calling the worker.
 *
 * The two deployables share a database but not a process (03 §1), and the queue
 * lives in the worker — so this is how a web request asks for background work.
 * Typed against the worker's own route definitions through Hono RPC would be
 * the eventual shape (binding rule 10); today there is one endpoint and a
 * hand-written call is honest about that.
 *
 * ## Every call here is best-effort, by design
 *
 * Nothing this module does is load-bearing for correctness. A confirmed booking
 * is already committed, with its outbox row, before any of this runs. If the
 * worker is unreachable the sweep still sends the confirmation and the
 * exceptions inbox still surfaces the unreflected reservation after sixty
 * seconds (PRD C1). That is why these failures are logged and swallowed rather
 * than shown to a guest who has just booked: there is nothing for them to do
 * about it, and nothing has actually gone wrong with their booking.
 */

function workerUrl(): string | null {
  return process.env.WORKER_URL ?? null
}

function token(): string | null {
  return process.env.WORKER_INTERNAL_TOKEN ?? null
}

/**
 * Tell the worker a booking was confirmed: reflect it, and send the guest their
 * confirmation.
 *
 * Returns whether the nudge landed, for logging. Never throws.
 */
export async function notifyBookingConfirmed(input: {
  propertyId: string
  reservationId: string
  notificationId: string | null
}): Promise<boolean> {
  const base = workerUrl()
  const secret = token()

  if (!base || !secret) {
    // Configuration, not a runtime failure. Loud in the log because in any
    // deployed environment it means every booking is taking the slow path.
    console.warn('[booking] WORKER_URL or WORKER_INTERNAL_TOKEN is unset; relying on the sweep')
    return false
  }

  try {
    const response = await fetch(`${base}/jobs/booking-confirmed`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        ...(input.notificationId ? { notificationId: input.notificationId } : {}),
      }),
      // Short. The guest is waiting on this response, and the fallback paths
      // exist precisely so we never have to make them wait for a slow worker.
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      console.warn('[booking] worker refused the confirmation nudge', response.status)
      return false
    }

    return true
  } catch (error) {
    console.warn('[booking] could not reach the worker', error)
    return false
  }
}

/**
 * Re-enqueue a reflection, from the exceptions inbox.
 *
 * Unlike the confirmation nudge above, this one *is* the mechanism — an owner
 * pressing retry has no other path. It still cannot throw at them: a queue that
 * is unreachable leaves the exception exactly where it was, which is the state
 * they are already looking at.
 */
export async function retryReflection(input: {
  propertyId: string
  reservationId: string
}): Promise<boolean> {
  const base = workerUrl()
  const secret = token()

  if (!base || !secret) {
    console.warn('[exceptions] WORKER_URL or WORKER_INTERNAL_TOKEN is unset; cannot retry')
    return false
  }

  try {
    const response = await fetch(`${base}/jobs/reservation-reflect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    })

    return response.ok
  } catch (error) {
    console.warn('[exceptions] could not reach the worker', error)
    return false
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
//
// MEMO: no provider is connected. The worker runs `MockPaymentAdapter`, which
// moves no money (ADR-010). Everything the web app does here is production
// shape — it never talks to a provider directly, only to the worker, which is
// the one process that holds the credentials.

export interface CheckoutResult {
  status: 'payment-required' | 'no-payment-required' | 'already-started' | 'rejected'
  checkoutUrl?: string | null
  amountCents?: number
  currency?: string
  reason?: string
  simulated?: boolean
}

/** Starts a payment for a held reservation. Throws only on a broken worker. */
export async function startCheckout(input: {
  propertyId: string
  reservationId: string
  returnUrl: string
}): Promise<CheckoutResult> {
  const base = workerUrl()
  const secret = token()

  if (!base || !secret) {
    return { status: 'rejected', reason: 'payments are not configured in this environment' }
  }

  try {
    const response = await fetch(`${base}/jobs/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      return { status: 'rejected', reason: `worker returned ${response.status}` }
    }

    return (await response.json()) as CheckoutResult
  } catch (error) {
    console.warn('[payments] could not reach the worker', error)

    return { status: 'rejected', reason: 'the payment service is unreachable' }
  }
}

/**
 * Whether the configured provider moves real money.
 *
 * **Defaults to `true` — simulated — when the worker cannot be reached**, and
 * that direction is deliberate. The consequence of wrongly showing the notice
 * is a confused guest; the consequence of wrongly hiding it is a guest who
 * believes they paid. Only a live answer from the worker turns the warning off.
 */
export async function paymentsAreSimulated(): Promise<boolean> {
  const base = workerUrl()
  if (!base) return true

  try {
    const response = await fetch(`${base}/health/payments`, {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    })

    if (!response.ok) return true

    const body = (await response.json()) as { simulated?: boolean }

    return body.simulated !== false
  } catch {
    return true
  }
}

/**
 * MEMO — SIMULATED PAYMENT. Reads one intent so the fake checkout page can show
 * an amount. This whole function disappears with the mock.
 */
export async function readSimulatedIntent(intentId: string): Promise<{
  id: string
  amountCents: number
  currency: string
  status: string
  reservationId: string
  propertyId: string
} | null> {
  const base = workerUrl()
  const secret = token()
  if (!base || !secret) return null

  try {
    const response = await fetch(`${base}/jobs/payment-intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ intentId }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })

    if (!response.ok) return null

    return (await response.json()) as {
      id: string
      amountCents: number
      currency: string
      status: string
      reservationId: string
      propertyId: string
    }
  } catch {
    return null
  }
}

/**
 * MEMO — SIMULATED PAYMENT. Stands in for a guest entering a card.
 *
 * The worker feeds the result through the real webhook path, so what this
 * exercises is what will ship. Disappears with the mock.
 */
export async function simulatePayment(input: {
  intentId: string
  outcome: 'succeeded' | 'failed' | 'requires_action'
}): Promise<boolean> {
  const base = workerUrl()
  const secret = token()
  if (!base || !secret) return false

  try {
    const response = await fetch(`${base}/jobs/payment-simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    })

    return response.ok
  } catch (error) {
    console.warn('[payments] could not reach the worker to simulate', error)

    return false
  }
}

// ---------------------------------------------------------------------------
// Cancellation (E1.4)
// ---------------------------------------------------------------------------

export interface CancellationQuoteResult {
  refundCents: number
  retainedCents: number
  refundPercent: number
  hoursBeforeArrival: number
  appliedWindow: { hoursBeforeArrival: number; refundPercent: number } | null
  paidCents: number
  currency: string
  cancellable: boolean
  status: string
  reference: string
  arrivalDate: string
  departureDate: string
}

/** What the guest would get back. Shown before the button, never after. */
export async function cancellationQuote(input: {
  propertyId: string
  reservationId: string
}): Promise<CancellationQuoteResult | null> {
  const base = workerUrl()
  const secret = token()
  if (!base || !secret) return null

  try {
    const response = await fetch(`${base}/jobs/cancellation-quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })

    if (!response.ok) return null

    return (await response.json()) as CancellationQuoteResult
  } catch (error) {
    console.warn('[cancel] could not reach the worker', error)

    return null
  }
}

export async function requestCancellation(input: {
  propertyId: string
  reservationId: string
}): Promise<{ status: string; refundCents?: number; refundFailed?: boolean }> {
  const base = workerUrl()
  const secret = token()
  if (!base || !secret) return { status: 'rejected' }

  try {
    const response = await fetch(`${base}/jobs/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) return { status: 'rejected' }

    return (await response.json()) as {
      status: string
      refundCents?: number
      refundFailed?: boolean
    }
  } catch (error) {
    console.warn('[cancel] could not reach the worker', error)

    return { status: 'rejected' }
  }
}
