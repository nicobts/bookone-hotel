import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import { guests, properties, reservations } from '../db/schema'
import { readContactEmail } from '../booking/request'
import { ESCALATION_ALERT, queueNotification } from '../notifications'

/**
 * Telling the property somebody is waiting (E3.2 SLA alert).
 *
 * Goes to the property, in the property's language, and never to the guest. It
 * says who is waiting and how long, and it links to the thread; it deliberately
 * does not restate the guest's question, because an owner who can read the
 * question in an email answers the email and the guest never sees it.
 *
 * ## Why the property may simply not be reachable
 *
 * Returns null when no contact address is published, and the sweep stamps
 * `sla_alerted_at` anyway. That looks like giving up and is the opposite: the
 * alternative is a sweep that retries an undeliverable alert on the same thread
 * forever, starving every other property in the batch. The unowned thread is
 * still in the console, which is where an owner who reads nothing else will
 * find it.
 */
export async function alertEscalation(input: {
  propertyId: string
  reservationId: string
  threadId: string
  escalatedAt: Date | null
  /** Public base URL, so the alert links to the thread rather than describing it. */
  appUrl: string
  now?: Date
}): Promise<string | null> {
  const now = input.now ?? new Date()

  return asService(async (db) => {
    const [row] = await db
      .select({
        slug: properties.slug,
        settings: properties.settings,
        localeDefault: properties.localeDefault,
        reference: reservations.reference,
        guestName: guests.name,
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

    if (!row) return null

    const contact = readContactEmail(row.settings)
    if (!contact) return null

    const minutesWaiting = input.escalatedAt
      ? Math.max(0, Math.round((now.getTime() - input.escalatedAt.getTime()) / 60_000))
      : 0

    return db.transaction((tx) =>
      queueNotification(tx, {
        propertyId: input.propertyId,
        /*
         * Deliberately *not* scoped to the reservation.
         *
         * The outbox deduplicates on (reservation, template, channel), which is
         * exactly right for a confirmation and exactly wrong here: a guest who
         * is left waiting twice during one stay must produce two alerts. The
         * once-only guarantee for a single escalation is `sla_alerted_at` on
         * the thread, which is where it belongs — it is a fact about the
         * escalation, not about the message.
         */
        channel: 'email',
        template: ESCALATION_ALERT,
        locale: row.localeDefault,
        recipient: contact,
        payload: {
          guestName: row.guestName ?? row.reference ?? 'A guest',
          reference: row.reference ?? '',
          minutesWaiting,
          threadUrl: `${input.appUrl.replace(/\/$/, '')}/${row.localeDefault}/${row.slug}/console/conversations/${input.threadId}`,
        },
      }),
    )
  })
}
