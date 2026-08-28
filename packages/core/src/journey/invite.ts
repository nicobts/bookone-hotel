import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { guests, properties, reservations } from '../db/schema'
import { systemActor } from '../events/actor'
import { PRECHECKIN_INVITE, queueNotification } from '../notifications/outbox'
import type { PrecheckinInviteFacts } from '../notifications/templates'
import { applyJourneyCommandIn } from './apply'
import { signStayToken } from './token'

/**
 * The T-48h pre-arrival invitation (E2.1).
 *
 * One transaction does both halves: the journey moves to `invited` and the
 * message is queued. Splitting them produces the two failures that matter — a
 * journey marked invited with no email sent, and an email sent every time the
 * sweep runs because nothing recorded that it had been.
 *
 * The machine is what makes the second impossible: `precheckin.invite` from
 * `invited` is a no-op, so a sweep that runs every hour still sends one email.
 */

export type InviteOutcome =
  | { status: 'invited'; notificationId: string | null }
  /** Already invited, or the guest finished before the sweep reached them. */
  | { status: 'skipped'; reason: string }
  | { status: 'rejected'; reason: string }

export async function sendPrecheckinInvite(input: {
  propertyId: string
  reservationId: string
}): Promise<InviteOutcome> {
  const { propertyId, reservationId } = input

  const row = await asService(async (db) => {
    const [found] = await db
      .select({
        reservationId: reservations.id,
        status: reservations.status,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        propertySlug: properties.slug,
        propertyName: properties.name,
        propertyLocale: properties.localeDefault,
        guestName: guests.name,
        guestEmail: guests.email,
        guestLocale: guests.locale,
      })
      .from(reservations)
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    return found ?? null
  })

  if (!row) return { status: 'rejected', reason: 'unknown reservation' }
  if (row.status !== 'confirmed') return { status: 'skipped', reason: `status is ${row.status}` }

  if (!row.guestEmail) {
    // A confirmed booking with no email. Not reachable through the booking
    // surface, which requires one — but a PMS-originated reservation may have
    // none, and inventing a channel is not an option.
    return { status: 'skipped', reason: 'no email for this guest' }
  }

  const token = signStayToken(reservationId, row.departureDate)

  if (!token) {
    // No signing secret configured. Refusing beats sending a link that will not
    // work — a guest who follows a broken check-in link phones the property,
    // which is the chore this feature exists to remove.
    return { status: 'rejected', reason: 'stay tokens are not configured' }
  }

  const locale = row.guestLocale ?? row.propertyLocale

  const facts: PrecheckinInviteFacts = {
    propertyName: row.propertyName,
    guestName: row.guestName ?? '',
    arrivalDate: row.arrivalDate,
    checkinUrl: stayUrl(locale, token),
  }

  return asService((db) =>
    db.transaction(async (tx) => {
      const applied = await applyJourneyCommandIn(tx, {
        propertyId,
        reservationId,
        command: { type: 'precheckin.invite' },
        // The system invites. No guest and no staff member did this — a sweep
        // did, and the audit trail should say so.
        actor: systemActor,
      })

      if (applied.status === 'no-op') {
        return { status: 'skipped' as const, reason: applied.reason }
      }

      if (applied.status !== 'applied') {
        return {
          status: 'rejected' as const,
          reason: applied.status === 'refused' ? applied.reason : 'unknown reservation',
        }
      }

      const notificationId = await queueNotification(tx, {
        propertyId,
        reservationId,
        channel: 'email',
        template: PRECHECKIN_INVITE,
        locale,
        recipient: row.guestEmail!,
        payload: facts as unknown as Record<string, unknown>,
      })

      return { status: 'invited' as const, notificationId }
    }),
  )
}

/**
 * The link the guest follows.
 *
 * The token is the whole path — no reservation id, no property slug. Anything
 * else in the URL would be a second identifier for the same thing, and the one
 * that is not signed is the one somebody would eventually trust.
 */
export function stayUrl(locale: string, token: string): string {
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return `${base.replace(/\/$/, '')}/${locale}/stay/${token}`
}
