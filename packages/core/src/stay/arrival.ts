import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs, guests, properties, reservations, roomTypes } from '../db/schema'
import { emit } from '../events'
import { systemActor, type Actor } from '../events/actor'
import { queueNotification } from '../notifications/outbox'
import { signStayToken } from '../journey/token'
import { stayUrl } from '../journey/invite'
import { WELCOME, type WelcomeFacts } from '../notifications/templates'
import type { PmsAdapter } from '../adapters/pms'
import { PmsAdapterError } from '../adapters/pms'

/**
 * What happens once a guest is actually here (E3.1).
 *
 * The journey command itself is `arrival.confirm`, applied by
 * `applyJourneyCommand` like every other transition. This module is the work
 * that follows it: post the check-in to the property's PMS, and send the guest
 * what they need to get into their room.
 *
 * ## Three triggers, one command
 *
 * A staff tap in the console, a guest tap on the stay surface, and a door event
 * from Rooms. None of them is privileged and none of them is special-cased —
 * which is the whole return on ADR-013's insistence that the journey moves only
 * by command. The third trigger does not exist yet and will not need this file
 * to change when it does; `ArrivalSource` is here so the event records which
 * one it was, because the zero-touch metric (G1) is the share that were *not* a
 * staff tap.
 *
 * ## Why the PMS post and the welcome are separate failures
 *
 * They fail for unrelated reasons and have unrelated consequences. A PMS that
 * is down means the property's own system does not yet show the guest in-house,
 * which staff can see and work around. A welcome that does not send means a
 * guest standing in a corridor without a door code. Bundling them into one
 * "arrival completed" step would make the first failure eat the second, and the
 * second is the one the guest feels.
 */

/** Which trigger fired. Recorded because G1 counts the ones that were not staff. */
export type ArrivalSource = 'guest' | 'staff' | 'door'

export interface CompleteArrivalInput {
  propertyId: string
  reservationId: string
  source: ArrivalSource
  actor?: Actor
  pms?: PmsAdapter
  at?: Date
}

export interface CompleteArrivalOutcome {
  /** Whether the PMS was told, and why not when it was not. */
  checkInPosted: boolean
  checkInError: string | null
  /** Null when the guest has no address we can reach, or it was already queued. */
  welcomeNotificationId: string | null
}

/**
 * The work after `arrival.confirm` (E3.1).
 *
 * Deliberately does not apply the journey command itself: the command is
 * applied by whoever received the trigger, and this runs after it. Splitting
 * them means a retried job re-attempts the *side effects* without re-asserting
 * a transition that has already happened.
 */
export async function completeArrival(
  input: CompleteArrivalInput,
): Promise<CompleteArrivalOutcome> {
  const at = input.at ?? new Date()

  const stay = await loadStay(input.propertyId, input.reservationId)
  if (!stay) {
    throw new Error(`reservation ${input.reservationId} not found for this property`)
  }

  let checkInPosted = false
  let checkInError: string | null = null

  if (input.pms) {
    if (!stay.externalId) {
      /*
       * Not an error, and not silent either.
       *
       * A reservation that has not reflected yet has no identity in the PMS to
       * check in. The reflection job will get there; the exceptions inbox
       * already surfaces one that does not. Inventing an external id here would
       * create a booking in the hotel's system at the moment somebody walked
       * through the door, which is the worst possible time to discover a
       * duplicate.
       */
      checkInError = 'not reflected to the PMS yet'
    } else {
      try {
        await input.pms.postCheckIn(input.propertyId, stay.externalId, at)
        checkInPosted = true
      } catch (error) {
        // Swallowed into the outcome rather than thrown. The guest's welcome
        // must not depend on the hotel's PMS being up.
        checkInError =
          error instanceof PmsAdapterError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error)
      }
    }
  }

  const welcomeNotificationId = await asService((db) =>
    db.transaction(async (tx) => {
      const id = stay.guestEmail
        ? await queueNotification(tx, {
            propertyId: input.propertyId,
            reservationId: input.reservationId,
            channel: 'email',
            template: WELCOME,
            // The guest's language, falling back to the property's rather than
            // to English: a property that operates in Italian would rather send
            // Italian to a guest whose locale we never learned.
            locale: stay.guestLocale ?? stay.propertyLocale,
            recipient: stay.guestEmail,
            /*
             * The link is built here, from a freshly signed token.
             *
             * The first version took a URL string from the worker, which built
             * it as `/stay/{reservationId}` — a link to a page that requires a
             * *signed token* and would have 404'd for every guest. Caught by
             * reading the queued payload after an arrival rather than by any
             * test, because nothing type-checks a string that looks like a URL.
             *
             * Constructing it where the departure date and the signing secret
             * already are is what makes the broken shape unrepresentable, and
             * it is the same `stayUrl` the pre-arrival invitation uses.
             */
            payload: welcomePayload(stay, stayLink(input.reservationId, stay)),
          })
        : null

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'reservation',
        entityId: input.reservationId,
        eventType: 'arrival.completed',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: {
          source: input.source,
          checkInPosted,
          ...(checkInError ? { checkInError } : {}),
        },
      })

      return id
    }),
  )

  return { checkInPosted, checkInError, welcomeNotificationId }
}

interface StayRow {
  reference: string | null
  arrivalDate: string
  departureDate: string
  propertyName: string
  propertyLocale: string
  propertySettings: unknown
  guestName: string | null
  guestEmail: string | null
  guestLocale: string | null
  roomName: unknown
  externalId: string | null
}

async function loadStay(propertyId: string, reservationId: string): Promise<StayRow | null> {
  const [row] = await asService((db) =>
    db
      .select({
        reference: reservations.reference,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        propertyName: properties.name,
        propertyLocale: properties.localeDefault,
        propertySettings: properties.settings,
        guestName: guests.name,
        guestEmail: guests.email,
        guestLocale: guests.locale,
        roomName: roomTypes.nameI18n,
        externalId: externalRefs.externalId,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .leftJoin(
        externalRefs,
        and(
          eq(externalRefs.entityId, reservations.id),
          eq(externalRefs.entityType, 'reservation'),
          eq(externalRefs.propertyId, reservations.propertyId),
        ),
      )
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1),
  )

  return row ?? null
}

/**
 * Pull the arrival facts out of the property's settings.
 *
 * `settings` is jsonb and every key here is optional, which is the honest shape
 * of a property that has filled in three of five fields on a Tuesday. Reading
 * defensively is not paranoia — the alternative is a welcome message with the
 * word "undefined" in it.
 */
export function welcomePayload(
  stay: {
    propertyName: string
    guestName: string | null
    roomName: unknown
    arrivalDate: string
    departureDate: string
    propertySettings: unknown
  },
  stayUrl: string | null,
): Record<string, unknown> {
  const settings = (
    typeof stay.propertySettings === 'object' && stay.propertySettings !== null
      ? stay.propertySettings
      : {}
  ) as Record<string, unknown>

  const arrival = (
    typeof settings.arrival === 'object' && settings.arrival !== null ? settings.arrival : {}
  ) as Record<string, unknown>

  const facts: WelcomeFacts = {
    propertyName: stay.propertyName,
    guestName: stay.guestName ?? '',
    roomName: readRoomName(stay.roomName),
    arrivalDate: stay.arrivalDate,
    departureDate: stay.departureDate,
    accessNote: readString(arrival.accessNote),
    wifiName: readString(arrival.wifiName),
    wifiPassword: readString(arrival.wifiPassword),
    stayUrl,
  }

  return facts as unknown as Record<string, unknown>
}

/**
 * The guest's own link, or null when tokens are not configured.
 *
 * Null rather than a best guess: the welcome then omits the line entirely,
 * which is the same discipline as the wifi password above. A broken link in a
 * welcome message produces a phone call, which is the chore this whole surface
 * exists to remove.
 */
function stayLink(
  reservationId: string,
  stay: { departureDate: string; guestLocale: string | null; propertyLocale: string },
): string | null {
  const token = signStayToken(reservationId, stay.departureDate)
  if (!token) return null

  return stayUrl(stay.guestLocale ?? stay.propertyLocale, token)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** The room snapshot is `{ it: "...", en: "..." }` or a plain string, depending on age. */
function readRoomName(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (typeof value !== 'object' || value === null) return null

  const names = value as Record<string, unknown>
  const name = names.name ?? names.en ?? Object.values(names)[0]

  return typeof name === 'string' && name.trim() ? name.trim() : null
}
