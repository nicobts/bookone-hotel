import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs, payments } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { confirmReservation } from '../booking/confirm'
import type { ConfirmOutcome } from '../booking/confirm'
import type { PaymentAdapter, PaymentEvent } from './adapter'

/**
 * The provider's webhook is the only state authority (03 §7.2).
 *
 * Not a stylistic preference. The browser returning from a checkout is a hint:
 * it can arrive before the provider has settled anything, arrive twice, arrive
 * from a guest who edited the URL, or never arrive because they closed the tab
 * on hotel wifi. The webhook is the only signal that means the money moved, so
 * it is the only thing allowed to confirm a booking.
 *
 * Everything here is idempotent, because webhooks are redelivered as a matter
 * of routine — a provider that gets no 2xx will send the same event for days.
 */

export type PaymentEventOutcome =
  | { status: 'confirmed'; reservationId: string; notificationId: string | null }
  | { status: 'already-applied' }
  | { status: 'recorded' }
  | { status: 'ignored'; reason: string }

/**
 * Applies one verified provider event.
 *
 * The signature was already checked by the adapter — this function trusts its
 * input, and that is only safe because `parseWebhook` throws rather than
 * returns on an untrusted payload.
 */
export async function applyPaymentEvent(
  deps: { adapter: PaymentAdapter },
  event: PaymentEvent,
): Promise<PaymentEventOutcome> {
  if (event.type === 'refund.succeeded') {
    // Refunds are recorded where they are issued (`cancelBooking`), because
    // that is where the policy decision and the reservation change live. The
    // event is an acknowledgement, not news.
    return { status: 'recorded' }
  }

  const { intent } = event
  const payment = await findPayment(intent.propertyId, intent.id, deps.adapter.provider)

  if (!payment) {
    // An intent we have no row for. Not an error worth retrying: either it
    // belongs to another environment sharing a provider account, or the
    // creating transaction rolled back. Logged by the caller and dropped.
    return { status: 'ignored', reason: 'no payment row for this intent' }
  }

  if (payment.status === 'succeeded' && event.type === 'payment.succeeded') {
    return { status: 'already-applied' }
  }

  if (event.type === 'payment.failed' || event.type === 'payment.cancelled') {
    await asService((db) =>
      db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            status: event.type === 'payment.failed' ? 'failed' : 'cancelled',
            failureReason: intent.failureReason ?? null,
          })
          .where(and(eq(payments.id, payment.id), eq(payments.propertyId, intent.propertyId)))

        await emit(tx, {
          propertyId: intent.propertyId,
          entityType: 'payment',
          entityId: payment.id,
          eventType: 'payment.failed',
          origin: 'platform',
          actor: systemActor,
          payload: {
            reservationId: payment.reservationId,
            reason: intent.failureReason ?? null,
            provider: deps.adapter.provider,
          },
        })
      }),
    )

    // The hold is deliberately left alone. E1.3: a failed payment returns the
    // guest to the payment step with a reason and the booking held for the rest
    // of its thirty minutes — cancelling here would punish a declined card by
    // taking the room away too.
    return { status: 'recorded' }
  }

  // Succeeded. Mark the money first, then confirm: if the process dies between
  // the two, the sweep sees a settled payment on an unconfirmed reservation and
  // finishes the job. The reverse order would leave a confirmed booking with no
  // record of payment, which nobody would ever notice.
  await asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: 'succeeded', settledAt: new Date(), failureReason: null })
        .where(and(eq(payments.id, payment.id), eq(payments.propertyId, intent.propertyId)))

      await emit(tx, {
        propertyId: intent.propertyId,
        entityType: 'payment',
        entityId: payment.id,
        eventType: 'payment.succeeded',
        origin: 'platform',
        actor: systemActor,
        payload: {
          reservationId: payment.reservationId,
          amountCents: payment.amountCents,
          currency: payment.currency,
          provider: deps.adapter.provider,
          simulated: payment.simulated,
          providerEventId: event.providerEventId,
        },
      })
    }),
  )

  const confirmed: ConfirmOutcome = await confirmReservation({
    propertyId: intent.propertyId,
    reservationId: payment.reservationId,
    // The system confirms, not the guest: this ran from a webhook, and
    // attributing it to the guest would be a small lie in the audit trail.
    actor: systemActor,
  })

  if (confirmed.status === 'confirmed') {
    return {
      status: 'confirmed',
      reservationId: confirmed.reservationId,
      notificationId: confirmed.notificationId,
    }
  }

  if (confirmed.status === 'already-confirmed') return { status: 'already-applied' }

  // Paid, but not confirmable — an expired hold is the realistic case. The
  // money is recorded and the exception is visible; refunding automatically
  // here would be a decision made by a job about someone else's money.
  return { status: 'ignored', reason: `payment settled but confirm returned ${confirmed.status}` }
}

async function findPayment(
  propertyId: string,
  intentId: string,
  provider: string,
): Promise<{
  id: string
  reservationId: string
  status: string
  amountCents: number
  currency: string
  simulated: boolean
} | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        id: payments.id,
        reservationId: payments.reservationId,
        status: payments.status,
        amountCents: payments.amountCents,
        currency: payments.currency,
        simulated: payments.simulated,
      })
      .from(payments)
      .innerJoin(
        externalRefs,
        and(
          eq(externalRefs.entityId, payments.id),
          eq(externalRefs.entityType, 'payment'),
          eq(externalRefs.system, provider),
          eq(externalRefs.externalId, intentId),
        ),
      )
      .where(eq(payments.propertyId, propertyId))
      .limit(1)

    return row ?? null
  })
}

/**
 * Payments the webhook never told us about (04 §1 Sprint 4: webhook-loss replay).
 *
 * A webhook is a network call from someone else's system to ours, and it will
 * be lost — a deploy at the wrong moment, a timeout, a provider incident. The
 * guest paid regardless, and the failure mode without this is the worst one in
 * the product: money taken and no booking.
 *
 * So the state authority is the webhook, and this is the audit that the
 * authority was heard. It asks the provider about every intent still sitting at
 * `requires_payment` past a grace period and applies what it finds — the same
 * code path, so a replayed event and a live one cannot diverge.
 */
export async function replayLostPayments(
  deps: { adapter: PaymentAdapter },
  input: { olderThanSeconds: number; limit: number; now?: Date },
): Promise<{ checked: number; recovered: number }> {
  const cutoff = new Date((input.now ?? new Date()).getTime() - input.olderThanSeconds * 1000)

  const pending = await asService((db) =>
    db
      .select({
        id: payments.id,
        propertyId: payments.propertyId,
        reservationId: payments.reservationId,
        externalId: externalRefs.externalId,
      })
      .from(payments)
      .innerJoin(
        externalRefs,
        and(
          eq(externalRefs.entityId, payments.id),
          eq(externalRefs.entityType, 'payment'),
          eq(externalRefs.system, deps.adapter.provider),
        ),
      )
      .where(
        and(
          inArray(payments.status, ['requires_payment', 'requires_action']),
          eq(payments.provider, deps.adapter.provider),
          lt(payments.createdAt, cutoff),
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(input.limit),
  )

  let recovered = 0

  for (const row of pending) {
    const intent = await deps.adapter.getIntent(row.propertyId, row.externalId)
    if (!intent || intent.status !== 'succeeded') continue

    const outcome = await applyPaymentEvent(deps, {
      type: 'payment.succeeded',
      intent,
      // Synthetic, and marked as such: this did not come from a delivered
      // event, and an audit that cannot tell the difference is worth less.
      providerEventId: `replay:${row.id}`,
    })

    if (outcome.status === 'confirmed') recovered += 1
  }

  return { checked: pending.length, recovered }
}

/** Holds whose payment never completed, for the expiry job to leave alone. */
export async function hasSettledPayment(reservationId: string): Promise<boolean> {
  return asService(async (db) => {
    const [row] = await db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.reservationId, reservationId), eq(payments.status, 'succeeded')))
      .limit(1)

    return Boolean(row)
  })
}

/** Everything a property actually holds for one reservation, in cents. */
export async function paidCents(propertyId: string, reservationId: string): Promise<number> {
  return asService(async (db) => {
    const rows = await db
      .select({ amountCents: payments.amountCents, status: payments.status })
      .from(payments)
      .where(and(eq(payments.propertyId, propertyId), eq(payments.reservationId, reservationId)))

    // Refunds are stored negative, so this is a plain sum — no caller has to
    // remember which signs to flip, which is exactly why the column is signed.
    return rows
      .filter((row) => row.status === 'succeeded')
      .reduce((total, row) => total + row.amountCents, 0)
  })
}

/** Used by the cancel path to find what to refund against. */
export async function settledDeposit(
  propertyId: string,
  reservationId: string,
  provider: string,
): Promise<{ paymentId: string; externalId: string; amountCents: number } | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        paymentId: payments.id,
        externalId: externalRefs.externalId,
        amountCents: payments.amountCents,
      })
      .from(payments)
      .innerJoin(
        externalRefs,
        and(
          eq(externalRefs.entityId, payments.id),
          eq(externalRefs.entityType, 'payment'),
          eq(externalRefs.system, provider),
        ),
      )
      .where(
        and(
          eq(payments.propertyId, propertyId),
          eq(payments.reservationId, reservationId),
          eq(payments.status, 'succeeded'),
          inArray(payments.kind, ['deposit', 'balance']),
        ),
      )
      .limit(1)

    return row ?? null
  })
}
