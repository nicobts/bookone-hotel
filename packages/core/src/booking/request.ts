import { eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { properties } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { BOOKING_REQUEST, queueNotification } from '../notifications/outbox'
import type { BookingRequestFacts } from '../notifications/templates'

/**
 * The fallback when the engine cannot price a stay (E1.1).
 *
 * Availability is a cache we do not own, and when it goes stale the honest
 * answer is that we do not know today's prices — not a stale price, and not an
 * empty list that reads as "no rooms" (design note §4C). This is what the guest
 * gets instead: their request, in the property's inbox, in the property's
 * language, with everything a human needs to answer it.
 *
 * It creates no reservation. There is nothing to reserve — that is the
 * situation. Sprint 4's quote work (E1.8) is where a request becomes something
 * the guest can accept; until then a person replies to an email, which is what
 * a small hotel does anyway and is a strictly better outcome than a lost guest.
 */

export interface BookingRequestInput {
  propertyId: string
  guestName: string
  guestEmail: string
  guestPhone?: string
  arrivalDate: string
  departureDate: string
  adults: number
  children: number
  message?: string
}

export type BookingRequestOutcome =
  | { status: 'sent'; notificationId: string }
  /**
   * The property has published no contact address. Not an error the guest
   * caused, and the surface says so plainly rather than pretending to have
   * sent something.
   */
  | { status: 'no-contact' }
  | { status: 'rejected'; reason: string }

export async function requestBooking(input: BookingRequestInput): Promise<BookingRequestOutcome> {
  const email = input.guestEmail.trim().toLowerCase()
  const name = input.guestName.trim()

  if (!name) return { status: 'rejected', reason: 'a name is required' }
  if (!email.includes('@')) return { status: 'rejected', reason: 'a valid email is required' }

  return asService(async (db) => {
    const [property] = await db
      .select({
        id: properties.id,
        settings: properties.settings,
        localeDefault: properties.localeDefault,
      })
      .from(properties)
      .where(eq(properties.id, input.propertyId))
      .limit(1)

    if (!property) return { status: 'rejected', reason: 'unknown property' }

    const contact = readContactEmail(property.settings)
    if (!contact) return { status: 'no-contact' }

    const facts: BookingRequestFacts = {
      guestName: name,
      guestEmail: email,
      guestPhone: input.guestPhone?.trim() || null,
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      adults: input.adults,
      children: input.children,
      message: input.message?.trim() || null,
    }

    return db.transaction(async (tx) => {
      const notificationId = await queueNotification(tx, {
        propertyId: property.id,
        channel: 'email',
        template: BOOKING_REQUEST,
        // The property's language, not the guest's. This message is read by
        // the hotel; the guest's own locale is a fact inside it.
        locale: property.localeDefault,
        recipient: contact,
        payload: facts as unknown as Record<string, unknown>,
      })

      if (!notificationId) return { status: 'no-contact' as const }

      await emit(tx, {
        propertyId: property.id,
        entityType: 'booking_request',
        eventType: 'booking.request_received',
        origin: 'platform',
        actor: systemActor,
        payload: {
          arrival: input.arrivalDate,
          departure: input.departureDate,
          adults: input.adults,
          children: input.children,
          // Deliberately no name, address or phone. The event log is read far
          // more widely than the outbox, and the contact details belong in the
          // one table whose policy was written for them.
        },
      })

      return { status: 'sent' as const, notificationId }
    })
  })
}

function readContactEmail(settings: unknown): string | null {
  if (settings === null || typeof settings !== 'object') return null

  const contact = (settings as Record<string, unknown>).contact
  if (contact === null || typeof contact !== 'object') return null

  const email = (contact as Record<string, unknown>).email

  return typeof email === 'string' && email.includes('@') ? email : null
}
