import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { guests, properties, reservations, roomTypes } from '../db/schema'
import { emit } from '../events'
import { guestActor } from '../events/actor'
import { BOOKING_CONFIRMATION, queueNotification } from '../notifications/outbox'
import { formatMoney, type BookingConfirmationFacts } from '../notifications/templates'
import { readTouristTaxPolicy, touristTaxNote } from './quote'

/**
 * Turning a hold into a booking (E1.2).
 *
 * One transaction does four things: records the guest, confirms the
 * reservation, writes the event, and queues the confirmation message. They
 * commit together because the alternatives are all failures a hotel finds out
 * about from a guest — a confirmed booking with no guest attached, a guest told
 * about a booking that rolled back, a confirmation nobody was told about.
 *
 * What is deliberately *not* in the transaction: reflecting to the PMS. That is
 * a network call to someone else's system and belongs in a job (PRD A3), and if
 * it never happens the exceptions inbox surfaces it after sixty seconds. The
 * booking is real either way — we are authoritative for it (D12).
 */

export interface ConfirmInput {
  propertyId: string
  reservationId: string
  guest: {
    name: string
    email: string
    phone?: string
    locale: string
    marketingConsent?: boolean
  }
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
  /** Idempotent: the job or the form ran twice. */
  | { status: 'already-confirmed'; reservationId: string; reference: string }
  /** The thirty minutes ran out. The guest is sent back to search. */
  | { status: 'expired'; reservationId: string }
  | { status: 'rejected'; reason: string }

export async function confirmBooking(input: ConfirmInput): Promise<ConfirmOutcome> {
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
        reference: reservations.reference,
        holdExpiresAt: reservations.holdExpiresAt,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
        totalCents: reservations.totalCents,
        currency: reservations.currency,
        guestId: reservations.guestId,
        roomTypeId: reservations.roomTypeId,
        roomNames: roomTypes.nameI18n,
        roomCode: roomTypes.code,
        propertyName: properties.name,
        propertySettings: properties.settings,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      // Scoped to the property as well as the id. The reservation id arrives
      // from a URL, and this is what stops one property's booking surface
      // confirming another's hold.
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return { status: 'rejected', reason: 'unknown reservation' }

    if (row.status === 'confirmed') {
      return {
        status: 'already-confirmed',
        reservationId: row.id,
        reference: row.reference ?? '',
      }
    }

    if (row.status !== 'hold') {
      return { status: 'rejected', reason: `reservation is ${row.status}` }
    }

    // Checked here rather than trusting the expiry job to have run. That job
    // runs every few minutes; a guest confirming in the gap would otherwise get
    // a booking the hold no longer covered, at a price the cache has moved past.
    if (row.holdExpiresAt && row.holdExpiresAt.getTime() < Date.now()) {
      return { status: 'expired', reservationId: row.id }
    }

    const pax = readPax(row.pax)
    const reference = row.reference ?? ''
    const totalCents = row.totalCents ?? 0
    const nightCount = countNights(row.arrivalDate, row.departureDate)

    const policy = readTouristTaxPolicy(row.propertySettings)
    const tax = policy
      ? touristTaxNote(policy, { nightCount, adults: pax.adults, children: pax.children })
      : null

    const facts: BookingConfirmationFacts = {
      propertyName: row.propertyName,
      guestName: name,
      reference,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      roomName: pickRoomName(row.roomNames, input.guest.locale, row.roomCode),
      adults: pax.adults,
      children: pax.children,
      totalCents,
      currency: row.currency,
      touristTaxPhrase: tax
        ? // Pre-formed here, so the template states a fact rather than computing
          // one (ADR-009 discipline). Everything in it came from the policy and
          // the reservation.
          `${formatMoney(tax.perPersonPerNightCents, tax.currency, input.guest.locale)} ` +
          `× ${tax.chargeablePeople} × ${tax.chargeableNights} = ` +
          formatMoney(tax.estimateCents, tax.currency, input.guest.locale)
        : null,
    }

    return db.transaction(async (tx) => {
      // One guest row per email per property. Matched rather than always
      // inserted, so a returning guest stays one person — which is what makes
      // the repeat-recognition journey in Sprint 7 possible at all.
      const [existing] = await tx
        .select({ id: guests.id })
        .from(guests)
        .where(and(eq(guests.propertyId, propertyId), eq(guests.email, email)))
        .limit(1)

      let guestId = existing?.id

      if (guestId) {
        await tx
          .update(guests)
          .set({
            name,
            locale: input.guest.locale,
            ...(input.guest.phone ? { phone: input.guest.phone } : {}),
            // Consent is only ever raised by an explicit act, never lowered by
            // a booking that did not mention it — and never defaulted true.
            ...(input.guest.marketingConsent ? { marketingConsent: true } : {}),
          })
          .where(and(eq(guests.id, guestId), eq(guests.propertyId, propertyId)))
      } else {
        const [created] = await tx
          .insert(guests)
          .values({
            propertyId,
            name,
            email,
            locale: input.guest.locale,
            ...(input.guest.phone ? { phone: input.guest.phone } : {}),
            marketingConsent: input.guest.marketingConsent === true,
          })
          .returning({ id: guests.id })

        if (!created) throw new Error('guests insert returned no row')
        guestId = created.id
      }

      const updated = await tx
        .update(reservations)
        .set({ status: 'confirmed', guestId })
        // Status re-checked in the update. Two browser tabs confirming the same
        // hold otherwise produce two confirmations, two events and two emails.
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
        actor: guestActor(row.id),
        payload: {
          reference,
          guestId,
          arrival: row.arrivalDate,
          departure: row.departureDate,
          totalCents,
          currency: row.currency,
          pax,
        },
      })

      const notificationId = await queueNotification(tx, {
        propertyId,
        reservationId: row.id,
        channel: 'email',
        template: BOOKING_CONFIRMATION,
        locale: input.guest.locale,
        recipient: email,
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

function readPax(value: unknown): { adults: number; children: number } {
  if (value === null || typeof value !== 'object') return { adults: 1, children: 0 }

  const record = value as Record<string, unknown>
  const adults = typeof record.adults === 'number' ? record.adults : 1
  const children = typeof record.children === 'number' ? record.children : 0

  return { adults, children }
}

/**
 * The guest's language, then whatever the property named it, then the code.
 *
 * The same guest -> property -> fallback chain as everywhere else (03 §6). The
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
