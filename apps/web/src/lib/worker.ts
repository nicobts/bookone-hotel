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

// ---------------------------------------------------------------------------
// Arrival and Alloggiati (E2.3, E3.1)
// ---------------------------------------------------------------------------

/**
 * Marks a guest arrived, which starts the registry filing.
 *
 * Routed through the worker because confirming arrival enqueues work, and the
 * queue lives there. The command itself is the journey machine's — the console
 * is one trigger source among several (ADR-013), not a special one.
 */
export async function confirmArrival(input: {
  propertyId: string
  reservationId: string
  /** Absent when the guest tapped it themselves — there is no user. */
  userId?: string
  /**
   * Which trigger fired (E3.1).
   *
   * Carried rather than inferred, because G1 counts the arrivals that were
   * *not* a staff tap and the worker defaults an unstated source to `staff` —
   * the reading that cannot inflate the metric by accident.
   */
  source: 'guest' | 'staff' | 'door'
}): Promise<boolean> {
  return post('/jobs/arrival-confirm', input)
}

// ---------------------------------------------------------------------------
// Messaging and departure (E3.2, E4.1)
// ---------------------------------------------------------------------------

/**
 * A guest sent a message (E3.2).
 *
 * Unlike everything else in this file, this one is **not** best-effort: if the
 * worker cannot be reached the message was never stored, and telling the guest
 * their message was sent would be false. The caller shows an error.
 */
export async function sendGuestMessage(input: {
  propertyId: string
  reservationId: string
  locale: string
  message: string
  intent?: 'question' | 'request'
}): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
  const base = workerUrl()
  const secret = token()

  if (!base || !secret) return { ok: false, error: 'not-configured' }

  try {
    const response = await fetch(`${base}/jobs/guest-message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: body.error ?? `worker returned ${response.status}` }
    }

    const body = (await response.json()) as { threadId: string }

    return { ok: true, threadId: body.threadId }
  } catch (error) {
    console.warn('[messaging] could not reach the worker', error)

    return { ok: false, error: 'unreachable' }
  }
}

/**
 * The guest is checking out (E4.1).
 *
 * MEMO — no payment provider is connected; nothing here moves money (ADR-010).
 * We also issue no invoice: `billTo` is a request routed to the property, whose
 * own certified chain issues the document (D11, binding rule 6).
 */
export async function confirmCheckout(input: {
  propertyId: string
  reservationId: string
  billTo?: string
  details?: Record<string, unknown>
}): Promise<boolean> {
  return post('/jobs/depart', input)
}

/**
 * Files this stay now (E2.3).
 *
 * The manual submit the acceptance criterion requires to be always present.
 * The property is the declarant; automation they cannot override is automation
 * they cannot answer for.
 */
export async function submitAlloggiatiNow(input: {
  propertyId: string
  reservationId: string
}): Promise<boolean> {
  return post('/jobs/alloggiati-submit', input)
}

/**
 * Apply an erasure request (E8.1).
 *
 * The one call in this module that is **not** best-effort in the way the header
 * describes, and it is worth being precise about the difference. The request
 * row is already committed with its deadline before this runs, so the
 * obligation survives an unreachable worker — but nothing else will pick the
 * erasure up on its own. There is no sweep for this and there should not be
 * one: a job that erases people if it notices an old row is a job that erases
 * somebody the day the desk has a bug.
 *
 * So the return value is used rather than logged. The desk tells the owner
 * whether it was queued or only recorded, and the runbook says how to run it by
 * hand.
 */
export async function requestErasure(input: {
  propertyId: string
  guestId: string
  requestId: string
  userId: string
}): Promise<boolean> {
  return post('/jobs/privacy-erase', input)
}

async function post(path: string, body: unknown): Promise<boolean> {
  const base = workerUrl()
  const secret = token()

  if (!base || !secret) {
    console.warn(`[worker] not configured; cannot call ${path}`)
    return false
  }

  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })

    return response.ok
  } catch (error) {
    console.warn(`[worker] could not reach ${path}`, error)

    return false
  }
}
