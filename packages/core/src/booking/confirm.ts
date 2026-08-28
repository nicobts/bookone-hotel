import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { asService } from '../db/session'
import { feeEvents, guests, properties, reservations, roomTypes } from '../db/schema'
import type * as schema from '../db/schema'
import { emit } from '../events'
import { guestActor, systemActor, type Actor } from '../events/actor'
import { BOOKING_CONFIRMATION, queueNotification } from '../notifications/outbox'
import { formatMoney, type BookingConfirmationFacts } from '../notifications/templates'
import { computeFee, readFeeRates } from '../payments/fees'
import { readTouristTaxPolicy, touristTaxNote } from './quote'

/**
 * Turning a hold into a booking (E1.2, E1.3).
 *
 * Split in two on purpose, because payment sits between the halves:
 *
 *   1. `attachGuest` — who is booking. Runs while the reservation is still a
 *      hold, from the browser, because that is where the guest typed it.
 *   2. `confirmReservation` — the booking is real. Runs from the **webhook**
 *      when a deposit is due (03 §7.2 makes the provider's webhook the only
 *      state authority), and directly from the browser when nothing is.
 *
 * The split is what lets a payment provider exist at all. A single function
 * that took guest details and confirmed would have to be called from a webhook
 * that has never seen them — so the details would end up on the payment
 * intent's metadata, in a third-party system, which is both a privacy problem
 * and a correctness one.
 *
 * `confirmReservation` does four things in one transaction: confirms, writes
 * the fee event, emits, and queues the guest's confirmation. They commit
 * together because every partial outcome is one a hotel discovers from an angry
 * guest — or from an invoice they cannot reconcile.
 *
 * What is deliberately *not* in the transaction: reflecting to the PMS. That is
 * a network call to someone else's system and belongs in a job (PRD A3); if it
 * never happens the exceptions inbox surfaces it after sixty seconds. The
 * booking is real either way — we are authoritative for it (D12).
 */

type Tx = PostgresJsDatabase<typeof schema>

export interface GuestDetails {
  name: string
  email: string
  phone?: string
  locale: string
  marketingConsent?: boolean
}

export type AttachGuestOutcome =
  | { status: 'attached'; guestId: string }
  | { status: 'already-confirmed' }
  | { status: 'expired' }
  | { status: 'rejected'; reason: string }

/**
 * Records who is booking, on a reservation that is still a hold.
 *
 * Written before payment rather than after, so the webhook has a guest to
 * confirm against. The row is real but the booking is not yet — an abandoned
 * hold leaves a guest record with no stay, which the E8 retention job clears.
 */
export async function attachGuest(input: {
  propertyId: string
  reservationId: string
  guest: GuestDetails
}): Promise<AttachGuestOutcome> {
  const { propertyId, reservationId } = input

  const email = input.guest.email.trim().toLowerCase()
  const name = input.guest.name.trim()

  if (!name) return { status: 'rejected', reason: 'a name is required' }
  if (!email.includes('@')) return { status: 'rejected', reason: 'a valid email is required' }

  return asService(async (db) => {
    const [row] = await db
      .select({
        id: reservations.id,
        status: reservations.status,
        holdExpiresAt: reservations.holdExpiresAt,
      })
      .from(reservations)
      // Scoped to the property as well as the id. The reservation id arrives
      // from a URL, and this is what stops one property's booking surface
      // writing a guest onto another's reservation.
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return { status: 'rejected', reason: 'unknown reservation' }
    if (row.status === 'confirmed') return { status: 'already-confirmed' }
    if (row.status !== 'hold') return { status: 'rejected', reason: `reservation is ${row.status}` }

    if (row.holdExpiresAt && row.holdExpiresAt.getTime() < Date.now()) {
      return { status: 'expired' }
    }

    return db.transaction(async (tx) => {
      const guestId = await upsertGuest(tx, propertyId, { ...input.guest, email, name })

      await tx
        .update(reservations)
        .set({ guestId })
        .where(and(eq(reservations.id, row.id), eq(reservations.propertyId, propertyId)))

      await emit(tx, {
        propertyId,
        entityType: 'reservation',
        entityId: row.id,
        eventType: 'reservation.guest_attached',
        origin: 'platform',
        actor: guestActor(row.id),
        // No name, address or phone. The event log is read far more widely than
        // the tables it describes, and the contact details belong in `guests`,
        // whose policy was written for them.
        payload: { guestId },
      })

      return { status: 'attached' as const, guestId }
    })
  })
}

export type ConfirmOutcome =
  | {
      status: 'confirmed'
      reservationId: string
      reference: string
      totalCents: number
      currency: string
      /** Null when the confirmation was already queued by an earlier run. */
      notificationId: string | null
    }
  /** Idempotent: the webhook was redelivered, or the form ran twice. */
  | { status: 'already-confirmed'; reservationId: string; reference: string }
  /** The thirty minutes ran out. The guest is sent back to search. */
  | { status: 'expired'; reservationId: string }
  | { status: 'rejected'; reason: string }

/**
 * The booking becomes real.
 *
 * Called by the payment webhook when a deposit was due, and directly by the
 * booking surface when none was. Idempotent in both directions: a redelivered
 * webhook and a double-tapped button produce one confirmation, one fee and one
 * email.
 */
export async function confirmReservation(input: {
  propertyId: string
  reservationId: string
  /** Who caused it — the guest, or `system` when a webhook did. */
  actor?: Actor
}): Promise<ConfirmOutcome> {
  const { propertyId, reservationId } = input

  return asService(async (db) => {
    const [row] = await db
      .select({
        id: reservations.id,
        status: reservations.status,
        reference: reservations.reference,
        holdExpiresAt: reservations.holdExpiresAt,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
        totalCents: reservations.totalCents,
        currency: reservations.currency,
        guestId: reservations.guestId,
        engineSessionId: reservations.engineSessionId,
        conciergeSessionId: reservations.conciergeSessionId,
        roomNames: roomTypes.nameI18n,
        roomCode: roomTypes.code,
        guestName: guests.name,
        guestEmail: guests.email,
        guestLocale: guests.locale,
        propertyName: properties.name,
        propertySlug: properties.slug,
        propertySettings: properties.settings,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return { status: 'rejected', reason: 'unknown reservation' }

    if (row.status === 'confirmed') {
      return { status: 'already-confirmed', reservationId: row.id, reference: row.reference ?? '' }
    }

    if (row.status !== 'hold') {
      return { status: 'rejected', reason: `reservation is ${row.status}` }
    }

    // A guest is required. Confirming without one produces a stay nobody can be
    // told about and nobody can be checked in — and the notification below
    // would have no recipient.
    if (!row.guestId || !row.guestEmail) {
      return { status: 'rejected', reason: 'no guest is attached to this reservation' }
    }

    // Checked here rather than trusting the expiry job to have run. That job
    // runs every few minutes; a confirmation arriving in the gap would honour a
    // price the hold no longer covered.
    //
    // A *paid* booking past its expiry is a different problem and does not
    // arrive here: the webhook path re-reads the hold before paying, and a
    // capture against an expired hold is refunded rather than confirmed.
    if (row.holdExpiresAt && row.holdExpiresAt.getTime() < Date.now()) {
      return { status: 'expired', reservationId: row.id }
    }

    const pax = readPax(row.pax)
    const reference = row.reference ?? ''
    const totalCents = row.totalCents ?? 0
    const nightCount = countNights(row.arrivalDate, row.departureDate)
    const locale = row.guestLocale ?? 'en'

    const policy = readTouristTaxPolicy(row.propertySettings)
    const tax = policy
      ? touristTaxNote(policy, { nightCount, adults: pax.adults, children: pax.children })
      : null

    const facts: BookingConfirmationFacts = {
      propertyName: row.propertyName,
      guestName: row.guestName ?? '',
      reference,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      roomName: pickRoomName(row.roomNames, locale, row.roomCode),
      adults: pax.adults,
      children: pax.children,
      totalCents,
      currency: row.currency,
      touristTaxPhrase: tax
        ? // Pre-formed here, so the template states a fact rather than computing
          // one (ADR-009 discipline). Everything in it came from the policy and
          // the reservation.
          `${formatMoney(tax.perPersonPerNightCents, tax.currency, locale)} ` +
          `× ${tax.chargeablePeople} × ${tax.chargeableNights} = ` +
          formatMoney(tax.estimateCents, tax.currency, locale)
        : null,
      manageUrl: manageUrl(locale, row.propertySlug, row.id),
    }

    const fee = computeFee(readFeeRates(row.propertySettings), {
      totalCents,
      engineSessionId: row.engineSessionId,
      conciergeSessionId: row.conciergeSessionId,
    })

    return db.transaction(async (tx) => {
      const updated = await tx
        .update(reservations)
        .set({ status: 'confirmed' })
        // Status re-checked in the update. A redelivered webhook and a second
        // browser tab otherwise produce two confirmations, two fees, two emails.
        .where(and(eq(reservations.id, row.id), eq(reservations.status, 'hold')))
        .returning({ id: reservations.id })

      if (updated.length === 0) {
        return { status: 'already-confirmed' as const, reservationId: row.id, reference }
      }

      await emit(tx, {
        propertyId,
        entityType: 'reservation',
        entityId: row.id,
        eventType: 'reservation.confirmed',
        origin: 'platform',
        actor: input.actor ?? guestActor(row.id),
        payload: {
          reference,
          guestId: row.guestId,
          arrival: row.arrivalDate,
          departure: row.departureDate,
          totalCents,
          currency: row.currency,
          pax,
        },
      })

      // The fee, written once, from the values true now (D14). The unique
      // constraint on (reservation, kind) is the second line of defence behind
      // the status re-check above: this table is the invoice, and a duplicate
      // row here is a real overcharge.
      await tx
        .insert(feeEvents)
        .values({
          propertyId,
          reservationId: row.id,
          kind: fee.kind,
          basisCents: fee.basisCents,
          rateBps: fee.rateBps,
          feeCents: fee.feeCents,
          currency: row.currency,
          evidence: fee.evidence,
        })
        .onConflictDoNothing({ target: [feeEvents.reservationId, feeEvents.kind] })

      await emit(tx, {
        propertyId,
        entityType: 'reservation',
        entityId: row.id,
        eventType: 'fee.computed',
        origin: 'platform',
        actor: systemActor,
        payload: { kind: fee.kind, rateBps: fee.rateBps, feeCents: fee.feeCents },
      })

      const notificationId = await queueNotification(tx, {
        propertyId,
        reservationId: row.id,
        channel: 'email',
        template: BOOKING_CONFIRMATION,
        locale,
        recipient: row.guestEmail!,
        payload: facts as unknown as Record<string, unknown>,
      })

      return {
        status: 'confirmed' as const,
        reservationId: row.id,
        reference,
        totalCents,
        currency: row.currency,
        notificationId,
      }
    })
  })
}

/**
 * Attach and confirm in one call — the path a booking takes when the property
 * takes no deposit, and the shape the surface used before payments existed.
 */
export async function confirmBooking(input: {
  propertyId: string
  reservationId: string
  guest: GuestDetails
}): Promise<ConfirmOutcome> {
  const attached = await attachGuest(input)

  switch (attached.status) {
    case 'rejected':
      return { status: 'rejected', reason: attached.reason }
    case 'expired':
      return { status: 'expired', reservationId: input.reservationId }
    case 'already-confirmed':
      return confirmReservation(input)
    case 'attached':
      return confirmReservation(input)
  }
}

async function upsertGuest(
  tx: Tx,
  propertyId: string,
  guest: GuestDetails & { email: string; name: string },
): Promise<string> {
  // One guest row per email per property. Matched rather than always inserted,
  // so a returning guest stays one person — which is what makes the
  // repeat-recognition journey in Sprint 7 possible at all.
  const [existing] = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.propertyId, propertyId), eq(guests.email, guest.email)))
    .limit(1)

  if (existing) {
    await tx
      .update(guests)
      .set({
        name: guest.name,
        locale: guest.locale,
        ...(guest.phone ? { phone: guest.phone } : {}),
        // Consent is only ever raised by an explicit act, never lowered by a
        // booking that did not mention it — and never defaulted true.
        ...(guest.marketingConsent ? { marketingConsent: true } : {}),
      })
      .where(and(eq(guests.id, existing.id), eq(guests.propertyId, propertyId)))

    return existing.id
  }

  const [created] = await tx
    .insert(guests)
    .values({
      propertyId,
      name: guest.name,
      email: guest.email,
      locale: guest.locale,
      ...(guest.phone ? { phone: guest.phone } : {}),
      marketingConsent: guest.marketingConsent === true,
    })
    .returning({ id: guests.id })

  if (!created) throw new Error('guests insert returned no row')

  return created.id
}

function readPax(value: unknown): { adults: number; children: number } {
  if (value === null || typeof value !== 'object') return { adults: 1, children: 0 }

  const record = value as Record<string, unknown>

  return {
    adults: typeof record.adults === 'number' ? record.adults : 1,
    children: typeof record.children === 'number' ? record.children : 0,
  }
}

/**
 * The guest's language, then whatever the property named it, then the code.
 *
 * The same guest → property → fallback chain as everywhere else (03 §6). The
 * last resort is the room type's own code rather than an empty string: "DBL" is
 * unhelpful, but it is at least the thing the hotel calls it.
 */
function pickRoomName(names: unknown, locale: string, code: string | null): string {
  if (names !== null && typeof names === 'object') {
    const record = names as Record<string, unknown>

    for (const key of [locale, 'en', 'it', 'de', 'sl']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }

  return code ?? ''
}

function countNights(arrival: string, departure: string): number {
  const start = Date.parse(`${arrival}T00:00:00Z`)
  const end = Date.parse(`${departure}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0

  return Math.round((end - start) / 86_400_000)
}

/**
 * The self-service link that goes in the confirmation (E1.4).
 *
 * Built here rather than passed in because both callers — the browser and the
 * payment webhook — would otherwise each construct it, and the one in the
 * worker would be the one that drifts.
 *
 * The reservation UUID is the credential: unguessable, and scoped to a single
 * booking. A signed short-lived token is the upgrade, and it arrives with
 * `/stay/[token]` in Sprint 5 rather than being invented twice.
 */
function manageUrl(locale: string, slug: string, reservationId: string): string {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return `${base.replace(/\/$/, '')}/${locale}/book/${slug}/manage/${reservationId}`
}
