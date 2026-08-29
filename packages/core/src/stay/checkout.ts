import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  guests,
  invoiceRequests,
  journeyStates,
  payments,
  properties,
  reservations,
  stayExtras,
} from '../db/schema'
import { emit } from '../events'
import { guestActor, systemActor, type Actor } from '../events/actor'
import { queueNotification } from '../notifications/outbox'
import { INVOICE_REQUEST_ROUTED, REVIEW_REQUEST } from '../notifications/templates'
import { readContactEmail } from '../booking/request'
import { applyJourneyCommandIn } from '../journey/apply'

/**
 * Express checkout (E4.1).
 *
 * MEMO — **no payment provider is connected.** Everything here that settles an
 * amount runs through `PaymentAdapter`, which is `MockPaymentAdapter` in every
 * environment today: no money moves, and every surface that shows an amount
 * carries the simulated-payment notice (ADR-010, Sprint 4).
 *
 * ## What this module refuses to pretend
 *
 * **It is not the folio.** A PMS owns the minibar, the restaurant and the spa.
 * Our view of what a guest owes is partial by construction, so
 * `getCheckoutSummary` returns what *we* registered and says plainly that
 * anything charged at the property is settled with the property. A confidently
 * short total is worse than an honestly partial one, because the guest only
 * discovers the difference at the desk they were trying to avoid.
 *
 * **It issues nothing fiscal.** D11 and binding rule 6. `requestInvoice` records
 * that a guest asked and who for; the *fattura* is issued by the property's own
 * certified chain. We assign no number, generate no document and transmit
 * nothing to any authority. There is no code here that could, which is the
 * enforcement (ADR-002: absence, not policy).
 */

export interface CheckoutLine {
  id: string
  description: string
  amountCents: number
  currency: string
  source: 'platform' | 'pms'
  settled: boolean
}

export interface CheckoutSummary {
  reservationId: string
  reference: string | null
  arrivalDate: string
  departureDate: string
  currency: string
  /** What the guest has already paid us, from `payments`. Net of refunds. */
  paidCents: number
  /** Lines we registered and have not settled. The only thing we can charge. */
  outstandingCents: number
  lines: CheckoutLine[]
  /**
   * Always true in V1, and stated rather than implied.
   *
   * The checkout surface renders a sentence from this: anything charged at the
   * property is settled with the property. When a real PMS adapter reads a
   * folio through, this becomes a fact about that property's configuration
   * rather than a constant.
   */
  partialView: boolean
  departure: 'pending' | 'settled' | 'closed'
  invoiceRequested: boolean
}

export async function getCheckoutSummary(
  propertyId: string,
  reservationId: string,
): Promise<CheckoutSummary | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        reference: reservations.reference,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        currency: reservations.currency,
        departure: journeyStates.departure,
      })
      .from(reservations)
      .leftJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return null

    const lines = await db
      .select({
        id: stayExtras.id,
        description: stayExtras.description,
        amountCents: stayExtras.amountCents,
        currency: stayExtras.currency,
        source: stayExtras.source,
        paymentId: stayExtras.paymentId,
      })
      .from(stayExtras)
      .where(
        and(eq(stayExtras.reservationId, reservationId), eq(stayExtras.propertyId, propertyId)),
      )
      .orderBy(asc(stayExtras.createdAt))

    /*
     * Paid is computed from `payments`, not from the reservation total.
     *
     * Same reasoning as the refund quote in Sprint 4: what a guest paid and
     * what a stay costs are different numbers, and a checkout screen built on
     * the second will misreport every partially-paid stay. Refunds subtract.
     */
    const settled = await db
      .select({
        kind: payments.kind,
        amountCents: payments.amountCents,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, reservationId),
          eq(payments.propertyId, propertyId),
          eq(payments.status, 'succeeded'),
        ),
      )

    const paidCents = settled.reduce(
      (total, payment) =>
        payment.kind === 'refund' ? total - payment.amountCents : total + payment.amountCents,
      0,
    )

    const [invoice] = await db
      .select({ id: invoiceRequests.id })
      .from(invoiceRequests)
      .where(
        and(
          eq(invoiceRequests.reservationId, reservationId),
          eq(invoiceRequests.propertyId, propertyId),
        ),
      )
      .limit(1)

    return {
      reservationId,
      reference: row.reference,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      currency: row.currency,
      paidCents,
      outstandingCents: lines
        .filter((line) => line.source === 'platform' && !line.paymentId)
        .reduce((total, line) => total + line.amountCents, 0),
      lines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        amountCents: line.amountCents,
        currency: line.currency,
        source: line.source,
        settled: Boolean(line.paymentId),
      })),
      partialView: true,
      departure: row.departure ?? 'pending',
      invoiceRequested: Boolean(invoice),
    }
  })
}

/**
 * Register something we will settle (E4.1).
 *
 * A domain command rather than an insert policy, because an extra is an amount
 * a guest will be asked to pay: it emits its event, and the row can be traced
 * to the thing that created it (rls-policies-map footnote 31).
 */
export async function addStayExtra(input: {
  propertyId: string
  reservationId: string
  description: string
  amountCents: number
  currency?: string
  source?: 'platform' | 'pms'
  actor: Actor
}): Promise<string> {
  const description = input.description.trim()
  if (!description) throw new Error('an extra needs a description')
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error('an extra is a non-negative integer number of cents')
  }

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(stayExtras)
        .values({
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          description,
          amountCents: input.amountCents,
          currency: input.currency ?? 'EUR',
          source: input.source ?? 'platform',
        })
        .returning({ id: stayExtras.id })

      if (!row) throw new Error('stay_extras insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'stay_extra',
        entityId: row.id,
        eventType: 'extra.added',
        origin: 'platform',
        actor: input.actor,
        payload: { reservationId: input.reservationId, amountCents: input.amountCents },
      })

      return row.id
    }),
  )
}

/**
 * The guest asked the property for an invoice (E4.1).
 *
 * Records the request. Issues nothing — see the module header, and the comment
 * on the table. `routedAt` is stamped when the worker has handed it to the
 * property, so a request that never reached them is visibly unrouted rather
 * than indistinguishable from one that did.
 */
export async function requestInvoice(input: {
  propertyId: string
  reservationId: string
  billTo: string
  details?: Record<string, unknown>
}): Promise<{ id: string }> {
  const billTo = input.billTo.trim()
  if (!billTo) throw new Error('an invoice request needs somebody to bill')

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(invoiceRequests)
        .values({
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          billTo: billTo.slice(0, 300),
          details: input.details ?? {},
        })
        /*
         * A guest correcting their details replaces the request rather than
         * adding a second one. Two live requests for one stay is how a property
         * issues two documents — which is their problem to unpick, caused by us.
         */
        .onConflictDoUpdate({
          target: invoiceRequests.reservationId,
          set: { billTo: billTo.slice(0, 300), details: input.details ?? {}, routedAt: null },
        })
        .returning({ id: invoiceRequests.id })

      if (!row) throw new Error('invoice_requests insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'invoice_request',
        entityId: row.id,
        eventType: 'invoice.requested',
        origin: 'platform',
        actor: guestActor(input.reservationId),
        // The billing details themselves are not in the payload: the event log
        // is read by reporting queries and this is the guest's tax identity.
        payload: { reservationId: input.reservationId },
      })

      return { id: row.id }
    }),
  )
}

/** Stamped when the property has been told. Called by the routing job. */
export async function markInvoiceRouted(propertyId: string, reservationId: string): Promise<void> {
  await asService((db) =>
    db
      .update(invoiceRequests)
      .set({ routedAt: new Date() })
      .where(
        and(
          eq(invoiceRequests.reservationId, reservationId),
          eq(invoiceRequests.propertyId, propertyId),
        ),
      ),
  )
}

/**
 * Hand an invoice request to the property (E4.1).
 *
 * The whole of our involvement. We assign no number, generate no document,
 * compute no tax and transmit nothing to any authority (D11, binding rule 6) —
 * this queues an email carrying the guest's own words to the people whose
 * certified chain issues the fattura.
 *
 * Returns null when the property publishes no contact address, and the caller
 * stamps `routed_at` regardless: a request that cannot be delivered is still
 * visible on the stay, and retrying an undeliverable message forever would
 * starve the sweep.
 */
export async function queueInvoiceRequestToProperty(input: {
  propertyId: string
  reservationId: string
}): Promise<string | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        settings: properties.settings,
        localeDefault: properties.localeDefault,
        reference: reservations.reference,
        guestName: guests.name,
        billTo: invoiceRequests.billTo,
        details: invoiceRequests.details,
      })
      .from(invoiceRequests)
      .innerJoin(reservations, eq(reservations.id, invoiceRequests.reservationId))
      .innerJoin(properties, eq(properties.id, invoiceRequests.propertyId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(
        and(
          eq(invoiceRequests.reservationId, input.reservationId),
          eq(invoiceRequests.propertyId, input.propertyId),
        ),
      )
      .limit(1)

    if (!row) return null

    const contact = readContactEmail(row.settings)
    if (!contact) return null

    return db.transaction((tx) =>
      queueNotification(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        channel: 'email',
        // The property's language. They read this one; the guest's details are
        // facts inside it.
        locale: row.localeDefault,
        template: INVOICE_REQUEST_ROUTED,
        recipient: contact,
        payload: {
          guestName: row.guestName ?? '',
          reference: row.reference ?? '',
          billTo: row.billTo,
          details: formatDetails(row.details),
        },
      }),
    )
  })
}

/**
 * The extra billing fields, as text.
 *
 * Rendered rather than validated, and passed through exactly as the guest typed
 * them. A validation rule of ours that rejected a legitimate Austrian UID would
 * be us blocking a transaction we are not party to — see the column comment.
 */
function formatDetails(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null

  const entries = Object.entries(details as Record<string, unknown>).filter(
    ([, value]) => typeof value === 'string' && value.trim(),
  )

  if (entries.length === 0) return null

  return entries.map(([key, value]) => `${key}: ${String(value).trim()}`).join('\n')
}

/** Invoice requests the property has not been told about yet. */
export async function listUnroutedInvoiceRequests(
  limit = 100,
): Promise<{ id: string; propertyId: string; reservationId: string; billTo: string }[]> {
  return asService((db) =>
    db
      .select({
        id: invoiceRequests.id,
        propertyId: invoiceRequests.propertyId,
        reservationId: invoiceRequests.reservationId,
        billTo: invoiceRequests.billTo,
      })
      .from(invoiceRequests)
      .where(isNull(invoiceRequests.routedAt))
      .orderBy(asc(invoiceRequests.createdAt))
      .limit(limit),
  )
}

export type DepartureOutcome =
  | { status: 'settled'; outstandingCents: number }
  | { status: 'already-settled' }
  | { status: 'refused'; reason: string }
  | { status: 'unknown-reservation' }

/**
 * The guest says they are leaving (E4.1).
 *
 * Moves `departure` to `settled` through the journey machine like every other
 * transition (binding rule 4). Deliberately does **not** require the balance to
 * be zero: a guest with an unpaid minibar tab we cannot even see is still a
 * guest who has left, and refusing the transition would leave the stay open
 * forever while the property chases an amount that is not ours.
 *
 * The review request goes out afterwards, through the outbox, once — not on
 * this screen. See docs/design-notes/express-checkout.md §4D for why.
 */
export async function confirmDeparture(input: {
  propertyId: string
  reservationId: string
  actor?: Actor
  reviewUrl?: string | null
  at?: Date
}): Promise<DepartureOutcome> {
  const at = input.at ?? new Date()

  return asService((db) =>
    db.transaction(async (tx) => {
      const outcome = await applyJourneyCommandIn(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        command: { type: 'departure.settle' },
        actor: input.actor ?? guestActor(input.reservationId),
      })

      if (outcome.status === 'unknown-reservation')
        return { status: 'unknown-reservation' as const }
      if (outcome.status === 'no-op') return { status: 'already-settled' as const }
      if (outcome.status === 'refused') {
        return { status: 'refused' as const, reason: outcome.reason }
      }

      const [row] = await tx
        .select({
          currency: reservations.currency,
          guestEmail: guests.email,
          guestName: guests.name,
          guestLocale: guests.locale,
          propertyName: properties.name,
          propertyLocale: properties.localeDefault,
        })
        .from(reservations)
        .innerJoin(properties, eq(properties.id, reservations.propertyId))
        .leftJoin(guests, eq(guests.id, reservations.guestId))
        .where(
          and(
            eq(reservations.id, input.reservationId),
            eq(reservations.propertyId, input.propertyId),
          ),
        )
        .limit(1)

      const [outstanding] = await tx
        .select({ total: sql<number>`coalesce(sum(${stayExtras.amountCents}), 0)::int` })
        .from(stayExtras)
        .where(
          and(
            eq(stayExtras.reservationId, input.reservationId),
            eq(stayExtras.propertyId, input.propertyId),
            eq(stayExtras.source, 'platform'),
            isNull(stayExtras.paymentId),
          ),
        )

      if (row?.guestEmail && input.reviewUrl) {
        await queueNotification(tx, {
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          channel: 'email',
          template: REVIEW_REQUEST,
          locale: row.guestLocale ?? row.propertyLocale,
          recipient: row.guestEmail,
          payload: {
            propertyName: row.propertyName,
            guestName: row.guestName ?? '',
            reviewUrl: input.reviewUrl,
          },
        })
      }

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'reservation',
        entityId: input.reservationId,
        eventType: 'departure.confirmed',
        origin: 'platform',
        actor: input.actor ?? guestActor(input.reservationId),
        payload: { at: at.toISOString(), outstandingCents: outstanding?.total ?? 0 },
      })

      return { status: 'settled' as const, outstandingCents: outstanding?.total ?? 0 }
    }),
  )
}

/**
 * Stays whose departure date has passed and who never tapped anything.
 *
 * The nightly backstop. A guest who left at 06:00 without touching their phone
 * has still left — but the sweep records a **different actor and origin** from
 * a guest tap, because "the guest told us" and "the date passed" are different
 * facts and the second is occasionally wrong. That distinction is what makes
 * the express-checkout adoption number meaningful at all.
 */
export async function listDepartedStays(input: {
  now?: Date
  limit?: number
}): Promise<{ propertyId: string; reservationId: string; departureDate: string }[]> {
  const now = input.now ?? new Date()
  const today = now.toISOString().slice(0, 10)

  return asService((db) =>
    db
      .select({
        propertyId: reservations.propertyId,
        reservationId: reservations.id,
        departureDate: reservations.departureDate,
      })
      .from(reservations)
      .innerJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          eq(journeyStates.arrival, 'confirmed'),
          inArray(journeyStates.departure, ['pending', 'settled']),
          lt(reservations.departureDate, today),
        ),
      )
      .orderBy(asc(reservations.departureDate))
      .limit(input.limit ?? 200),
  )
}

/**
 * Close a stay that has ended (E4.1).
 *
 * `settle` then `close`, both by command. A stay the guest never checked out of
 * gets both in one sweep, under `system` — the actor is what tells an owner,
 * and the G1 calculation, which of the two happened.
 */
export async function closeDepartedStay(input: {
  propertyId: string
  reservationId: string
  at?: Date
}): Promise<'closed' | 'already-closed' | 'refused'> {
  return asService((db) =>
    db.transaction(async (tx) => {
      const settle = await applyJourneyCommandIn(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        command: { type: 'departure.settle' },
        actor: systemActor,
      })

      if (settle.status === 'refused') return 'refused' as const
      if (settle.status === 'unknown-reservation') return 'refused' as const

      const close = await applyJourneyCommandIn(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        command: { type: 'departure.close' },
        actor: systemActor,
      })

      if (close.status === 'no-op') return 'already-closed' as const
      if (close.status !== 'applied') return 'refused' as const

      return 'closed' as const
    }),
  )
}
