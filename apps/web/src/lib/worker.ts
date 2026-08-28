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
