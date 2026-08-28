import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs, payments, properties, reservations } from '../db/schema'
import { emit } from '../events'
import { guestActor } from '../events/actor'
import { computeDeposit, readBookingPolicy } from '../policy'
import { PaymentAdapterError, type PaymentAdapter } from './adapter'

/**
 * Starting a payment (E1.3, 03 §7.1).
 *
 * MEMO — no provider is connected. `MockPaymentAdapter` is what runs behind
 * this, and it moves no money (see its file header). Everything in *this* file
 * is production shape: the deposit comes from the property's policy, the
 * `payments` row is written before the guest leaves for the provider, the
 * provider's id is stored in `external_refs` like every other foreign id, and
 * nothing here confirms anything — the webhook does that.
 *
 * The order matters and is the opposite of the obvious one: the row is written
 * **before** the guest is sent to pay. A guest who pays against an intent we
 * have no record of is the worst outcome available, because the webhook arrives
 * with money attached and nothing to attach it to. A row with no payment is
 * merely an abandoned checkout, which the sweep resolves.
 */

export type CheckoutOutcome =
  /** Send the guest here. Nothing is confirmed until the webhook says so. */
  | { status: 'payment-required'; checkoutUrl: string; amountCents: number; currency: string }
  /** The property takes no deposit. The caller confirms directly. */
  | { status: 'no-payment-required' }
  /** Already paid, or already being paid. Idempotent re-entry. */
  | { status: 'already-started'; checkoutUrl: string | null }
  | { status: 'rejected'; reason: string; retryable: boolean }

export async function startCheckout(
  deps: { adapter: PaymentAdapter },
  input: { propertyId: string; reservationId: string; returnUrl: string },
): Promise<CheckoutOutcome> {
  const { adapter } = deps
  const { propertyId, reservationId } = input

  const prepared = await asService(async (db) => {
    const [row] = await db
      .select({
        id: reservations.id,
        status: reservations.status,
        holdExpiresAt: reservations.holdExpiresAt,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        totalCents: reservations.totalCents,
        currency: reservations.currency,
        guestId: reservations.guestId,
        settings: properties.settings,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return { kind: 'rejected' as const, reason: 'unknown reservation' }
    if (row.status === 'confirmed') return { kind: 'confirmed' as const }
    if (row.status !== 'hold') {
      return { kind: 'rejected' as const, reason: `reservation is ${row.status}` }
    }
    if (row.holdExpiresAt && row.holdExpiresAt.getTime() < Date.now()) {
      return { kind: 'rejected' as const, reason: 'hold expired' }
    }
    if (!row.guestId) {
      // Attach the guest first. Paying for a booking with nobody on it produces
      // a captured amount and no one to confirm, refund or contact.
      return { kind: 'rejected' as const, reason: 'no guest is attached yet' }
    }

    // An existing deposit row means checkout already started. Re-entering must
    // not create a second intent — a guest who refreshes the payment page would
    // otherwise be able to pay twice.
    const [existing] = await db
      .select({ id: payments.id, status: payments.status })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, row.id),
          eq(payments.kind, 'deposit'),
          eq(payments.provider, adapter.provider),
        ),
      )
      .limit(1)

    const policy = readBookingPolicy(row.settings)
    const deposit = computeDeposit(policy, {
      totalCents: row.totalCents ?? 0,
      nightCount: countNights(row.arrivalDate, row.departureDate),
    })

    return {
      kind: 'ready' as const,
      row,
      policy,
      deposit,
      existingPaymentId: existing?.id ?? null,
      existingStatus: existing?.status ?? null,
    }
  })

  if (prepared.kind === 'rejected') {
    return { status: 'rejected', reason: prepared.reason, retryable: false }
  }

  if (prepared.kind === 'confirmed') {
    return { status: 'already-started', checkoutUrl: null }
  }

  if (prepared.existingPaymentId) {
    // Look the intent back up rather than remembering its URL: the provider is
    // the authority on whether it is still payable, and a stored URL outlives
    // the intent it points at.
    const ref = await externalPaymentRef(propertyId, prepared.existingPaymentId, adapter.provider)
    const intent = ref ? await adapter.getIntent(propertyId, ref) : null

    return { status: 'already-started', checkoutUrl: intent?.checkoutUrl ?? null }
  }

  if (prepared.deposit.dueNowCents === 0) {
    return { status: 'no-payment-required' }
  }

  let intent
  try {
    intent = await adapter.createIntent({
      propertyId,
      reservationId,
      amountCents: prepared.deposit.dueNowCents,
      currency: prepared.row.currency,
      vaultCard: prepared.policy.vaultCard,
      returnUrl: input.returnUrl,
    })
  } catch (cause) {
    const error =
      cause instanceof PaymentAdapterError
        ? cause
        : new PaymentAdapterError('unavailable', String(cause), true)

    // Nothing was written, so nothing needs unwinding. The guest sees the
    // payment step again with a reason, and the hold is untouched.
    return { status: 'rejected', reason: error.message, retryable: error.retryable }
  }

  await asService((db) =>
    db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(payments)
        .values({
          propertyId,
          reservationId,
          kind: 'deposit',
          status: 'requires_payment',
          amountCents: prepared.deposit.dueNowCents,
          currency: prepared.row.currency,
          provider: adapter.provider,
          simulated: adapter.simulated,
        })
        .returning({ id: payments.id })

      if (!payment) throw new Error('payments insert returned no row')

      // The provider's id lives in `external_refs`, like every foreign id
      // (ADR-001, binding rule 1) — which also means a provider swap leaves no
      // column named after the provider we left.
      await tx.insert(externalRefs).values({
        propertyId,
        entityType: 'payment',
        entityId: payment.id,
        system: adapter.provider,
        externalId: intent.id,
      })

      await emit(tx, {
        propertyId,
        entityType: 'payment',
        entityId: payment.id,
        eventType: 'payment.intent_created',
        origin: 'platform',
        actor: guestActor(reservationId),
        payload: {
          reservationId,
          amountCents: prepared.deposit.dueNowCents,
          currency: prepared.row.currency,
          provider: adapter.provider,
          simulated: adapter.simulated,
        },
      })
    }),
  )

  return {
    status: 'payment-required',
    checkoutUrl: intent.checkoutUrl ?? input.returnUrl,
    amountCents: prepared.deposit.dueNowCents,
    currency: prepared.row.currency,
  }
}

/** The provider's id for one of our payment rows. */
export async function externalPaymentRef(
  propertyId: string,
  paymentId: string,
  system: string,
): Promise<string | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({ externalId: externalRefs.externalId })
      .from(externalRefs)
      .where(
        and(
          eq(externalRefs.propertyId, propertyId),
          eq(externalRefs.entityType, 'payment'),
          eq(externalRefs.entityId, paymentId),
          eq(externalRefs.system, system),
        ),
      )
      .limit(1)

    return row?.externalId ?? null
  })
}

function countNights(arrival: string, departure: string): number {
  const start = Date.parse(`${arrival}T00:00:00Z`)
  const end = Date.parse(`${departure}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0

  return Math.round((end - start) / 86_400_000)
}
