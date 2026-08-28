import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs, payments, properties, reservations } from '../db/schema'
import { emit } from '../events'
import { guestActor, type Actor } from '../events/actor'
import { computeRefund, readBookingPolicy, type RefundQuote } from '../policy'
import { PaymentAdapterError, type PaymentAdapter } from '../payments/adapter'
import { paidCents, settledDeposit } from '../payments/webhook'

/**
 * Self-service cancellation (E1.4).
 *
 * Two functions, and the split is the requirement: the guest must be shown the
 * refund **before** they confirm. A cancel button that reveals what it kept
 * afterwards is the single most reliable way to turn a routine cancellation
 * into a chargeback.
 *
 *   `quoteCancellation` — what would happen. Reads nothing but rows and a clock.
 *   `cancelBooking`     — do it. Refunds, cancels, and queues the PMS update.
 *
 * Both compute from what was actually **paid**, never from the stay total: a
 * percentage of money that never arrived is money we would be inventing.
 */

export interface CancellationQuote extends RefundQuote {
  reservationId: string
  reference: string
  status: string
  arrivalDate: string
  departureDate: string
  paidCents: number
  currency: string
  /** False once the stay has begun or the booking is already cancelled. */
  cancellable: boolean
}

export async function quoteCancellation(input: {
  propertyId: string
  reservationId: string
  now?: Date
}): Promise<CancellationQuote | null> {
  const { propertyId, reservationId } = input

  const row = await asService(async (db) => {
    const [found] = await db
      .select({
        id: reservations.id,
        reference: reservations.reference,
        status: reservations.status,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        currency: reservations.currency,
        settings: properties.settings,
        timezone: properties.timezone,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      // Scoped to the property as well as the id, like every other lookup that
      // takes an id from a URL.
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    return found ?? null
  })

  if (!row) return null

  const paid = await paidCents(propertyId, reservationId)
  const policy = readBookingPolicy(row.settings)

  const refund = computeRefund(policy, {
    paidCents: paid,
    arrivalDate: row.arrivalDate,
    timezone: row.timezone,
    ...(input.now ? { now: input.now } : {}),
  })

  return {
    ...refund,
    reservationId: row.id,
    reference: row.reference ?? '',
    status: row.status,
    arrivalDate: row.arrivalDate,
    departureDate: row.departureDate,
    paidCents: paid,
    currency: row.currency,
    // A stay that has started is a conversation with the front desk, not a
    // button. Past arrival the property decides, because only they know
    // whether the guest turned up.
    cancellable: row.status === 'confirmed' && refund.hoursBeforeArrival > 0,
  }
}

export type CancelOutcome =
  | { status: 'cancelled'; refundCents: number; refundFailed: boolean }
  | { status: 'already-cancelled' }
  | { status: 'rejected'; reason: string }

export async function cancelBooking(
  deps: { adapter: PaymentAdapter },
  input: { propertyId: string; reservationId: string; actor?: Actor; now?: Date },
): Promise<CancelOutcome> {
  const { propertyId, reservationId } = input

  const quote = await quoteCancellation(input)

  if (!quote) return { status: 'rejected', reason: 'unknown reservation' }
  if (quote.status === 'cancelled') return { status: 'already-cancelled' }
  if (!quote.cancellable) {
    return { status: 'rejected', reason: `reservation is ${quote.status} and cannot be cancelled` }
  }

  // The refund goes out before the cancellation is recorded, and the order is
  // deliberate. A refund that succeeds against a booking we failed to cancel is
  // recoverable — the money is back with the guest and the exception is
  // visible. A cancellation recorded against a refund that never happened
  // leaves a guest with no room and no money, and nothing to point at.
  let refundFailed = false

  if (quote.refundCents > 0) {
    const deposit = await settledDeposit(propertyId, reservationId, deps.adapter.provider)

    if (!deposit) {
      // Money is recorded as paid but no provider reference exists. Refusing is
      // right: this is the case where guessing moves someone's money.
      return { status: 'rejected', reason: 'cannot locate the payment to refund' }
    }

    try {
      const result = await deps.adapter.refund({
        propertyId,
        intentId: deposit.externalId,
        amountCents: quote.refundCents,
        reason: 'guest cancellation within policy',
      })

      await asService((db) =>
        db.transaction(async (tx) => {
          const [refundRow] = await tx
            .insert(payments)
            .values({
              propertyId,
              reservationId,
              kind: 'refund',
              status: result.status === 'succeeded' ? 'succeeded' : 'requires_payment',
              // Negative, so the column sums to what the property holds.
              amountCents: -quote.refundCents,
              currency: quote.currency,
              provider: deps.adapter.provider,
              simulated: deps.adapter.simulated,
              ...(result.status === 'succeeded' ? { settledAt: new Date() } : {}),
            })
            .returning({ id: payments.id })

          if (!refundRow) throw new Error('payments insert returned no row')

          await tx.insert(externalRefs).values({
            propertyId,
            entityType: 'payment',
            entityId: refundRow.id,
            system: deps.adapter.provider,
            externalId: result.id,
          })

          await emit(tx, {
            propertyId,
            entityType: 'payment',
            entityId: refundRow.id,
            eventType: 'payment.refunded',
            origin: 'platform',
            actor: input.actor ?? guestActor(reservationId),
            payload: {
              reservationId,
              amountCents: quote.refundCents,
              currency: quote.currency,
              refundPercent: quote.refundPercent,
              appliedWindow: quote.appliedWindow,
              provider: deps.adapter.provider,
              simulated: deps.adapter.simulated,
            },
          })
        }),
      )
    } catch (cause) {
      // Recorded and carried on. The guest still gets their cancellation — the
      // alternative is refusing to cancel because we could not pay them back,
      // which leaves them holding a booking they do not want *and* their money
      // with us. The failed refund surfaces as an exception for a person.
      refundFailed = true

      const message = cause instanceof PaymentAdapterError ? cause.message : String(cause)

      await asService((db) =>
        db.transaction((tx) =>
          emit(tx, {
            propertyId,
            entityType: 'reservation',
            entityId: reservationId,
            eventType: 'payment.refund_failed',
            origin: 'platform',
            actor: input.actor ?? guestActor(reservationId),
            payload: { amountCents: quote.refundCents, error: message },
          }),
        ),
      )
    }
  }

  const cancelled = await asService((db) =>
    db.transaction(async (tx) => {
      const updated = await tx
        .update(reservations)
        .set({ status: 'cancelled' })
        // Re-checked, so two tabs cannot cancel twice and refund twice.
        .where(
          and(
            eq(reservations.id, reservationId),
            eq(reservations.propertyId, propertyId),
            eq(reservations.status, 'confirmed'),
          ),
        )
        .returning({ id: reservations.id })

      if (updated.length === 0) return false

      await emit(tx, {
        propertyId,
        entityType: 'reservation',
        entityId: reservationId,
        eventType: 'reservation.cancelled',
        origin: 'platform',
        actor: input.actor ?? guestActor(reservationId),
        payload: {
          reference: quote.reference,
          refundCents: quote.refundCents,
          retainedCents: quote.retainedCents,
          refundPercent: quote.refundPercent,
          hoursBeforeArrival: Math.round(quote.hoursBeforeArrival),
          refundFailed,
        },
      })

      return true
    }),
  )

  if (!cancelled) return { status: 'already-cancelled' }

  // The fee event is deliberately left in place. D14 computes the fee at
  // confirmation, and whether a cancelled booking is still billable is a
  // commercial question for the contract, not one a cancellation handler should
  // answer by deleting the evidence. Sprint 8's report is where that decision
  // gets made, with the rows intact either way.

  return { status: 'cancelled', refundCents: quote.refundCents, refundFailed }
}
