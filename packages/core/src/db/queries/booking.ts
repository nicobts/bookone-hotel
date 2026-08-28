import { and, eq } from 'drizzle-orm'
import { asService } from '../session'
import { guests, properties, reservations, roomTypes } from '../schema'
import { resolveAuthority } from '../../authority'

/**
 * Reads for the public booking surface (E1.1, E1.2).
 *
 * Separate from `queries/properties.ts` because these run for an anonymous
 * visitor and those run for a signed-in member. The distinction is the whole
 * security story of this file: there is no JWT here for a policy to read, so
 * these queries run under `asService` and the explicit `property_id` on every
 * one of them *is* the isolation (ADR-007, binding rule 3).
 *
 * Each function therefore returns exactly what a stranger may see and nothing
 * more. Note what is absent from `BookingProperty`: the authority map, the
 * members, the settings blob. A guest gets a name, a theme and a tax rule.
 */

export interface BookingProperty {
  id: string
  slug: string
  name: string
  /** The subset this property actually offers — the switcher shows these only. */
  languages: string[]
  localeDefault: string
  timezone: string
  /** Whitelabel overrides, read into `--bo-primary` / `--bo-accent`. */
  theme: { primary?: string; accent?: string }
  /** Contact shown on the fallback form when live prices cannot be reached. */
  contact: { email?: string; phone?: string }
  /** Passed to the quote so the tourist-tax note can be computed. */
  settings: unknown
}

/**
 * The property behind a booking URL.
 *
 * Returns null when the slug is unknown **or** when the PMS is authoritative
 * for booking at that property — in the second case there is no engine to
 * offer, and rendering one would take a booking we cannot honour. The caller
 * turns both into a 404, which is also the only answer that does not confirm
 * whether a guessed slug exists.
 */
export async function getBookingProperty(slug: string): Promise<BookingProperty | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        id: properties.id,
        slug: properties.slug,
        name: properties.name,
        languages: properties.languages,
        localeDefault: properties.localeDefault,
        timezone: properties.timezone,
        settings: properties.settings,
        authorityMap: properties.authorityMap,
      })
      .from(properties)
      .where(eq(properties.slug, slug))
      .limit(1)

    if (!row) return null
    if (resolveAuthority(row.authorityMap, 'booking') !== 'platform') return null

    const settings = (
      row.settings !== null && typeof row.settings === 'object' ? row.settings : {}
    ) as Record<string, unknown>

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      languages: readLanguages(row.languages, row.localeDefault),
      localeDefault: row.localeDefault,
      timezone: row.timezone,
      theme: readRecord(settings.theme),
      contact: readRecord(settings.contact),
      settings: row.settings,
    }
  })
}

export interface HeldBooking {
  id: string
  reference: string
  status: string
  arrivalDate: string
  departureDate: string
  adults: number
  children: number
  totalCents: number
  currency: string
  roomTypeId: string | null
  roomNameI18n: Record<string, string>
  roomCode: string | null
  expiresAt: Date | null
  /** Null until the booking is confirmed and a guest is attached. */
  guestId: string | null
  /**
   * Shown back on the confirmation screen so the guest can see where their
   * email is going — and catch a typo while the property can still be called.
   */
  guestEmail: string | null
}

/**
 * One reservation, for the guest holding its id.
 *
 * Scoped to the property as well as the id: the id comes out of a URL, and this
 * is what stops one property's booking page displaying another's reservation.
 * Everything returned is something the person who made the booking already
 * knows — no guest record, no internal ids beyond the one they were handed.
 */
export async function getHeldBooking(
  propertyId: string,
  reservationId: string,
): Promise<HeldBooking | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        id: reservations.id,
        reference: reservations.reference,
        status: reservations.status,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
        totalCents: reservations.totalCents,
        currency: reservations.currency,
        roomTypeId: reservations.roomTypeId,
        roomNameI18n: roomTypes.nameI18n,
        roomCode: roomTypes.code,
        expiresAt: reservations.holdExpiresAt,
        guestId: reservations.guestId,
        guestEmail: guests.email,
      })
      .from(reservations)
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!row) return null

    const pax = (row.pax !== null && typeof row.pax === 'object' ? row.pax : {}) as Record<
      string,
      unknown
    >

    return {
      id: row.id,
      reference: row.reference ?? '',
      status: row.status,
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      adults: typeof pax.adults === 'number' ? pax.adults : 1,
      children: typeof pax.children === 'number' ? pax.children : 0,
      totalCents: row.totalCents ?? 0,
      currency: row.currency,
      roomTypeId: row.roomTypeId,
      roomNameI18n: readStringRecord(row.roomNameI18n),
      roomCode: row.roomCode,
      expiresAt: row.expiresAt,
      guestId: row.guestId,
      guestEmail: row.guestEmail,
    }
  })
}

function readLanguages(value: unknown, fallback: string): string[] {
  const list = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

  // Never empty. A property with no declared languages still has to render in
  // one, and its own default is the honest choice.
  return list.length > 0 ? list : [fallback]
}

function readRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

const readStringRecord = readRecord
