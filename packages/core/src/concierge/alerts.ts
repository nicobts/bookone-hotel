import { and, eq, sql } from 'drizzle-orm'
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
  /**
   * Who is told (ADR-035). `all` — the contact email and the owner's phones —
   * for the SLA reminder and a complaint. `phone` — the owner's phones only —
   * at the moment of handover, so the owner hears within seconds while the
   * email stays the 30-minute reminder rather than arriving twice.
   */
  reach?: 'all' | 'phone'
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

    const reach = input.reach ?? 'all'
    const contact = reach === 'all' ? readContactEmail(row.settings) : null

    const minutesWaiting = input.escalatedAt
      ? Math.max(0, Math.round((now.getTime() - input.escalatedAt.getTime()) / 60_000))
      : 0

    const payload = {
      guestName: row.guestName ?? row.reference ?? 'A guest',
      reference: row.reference ?? '',
      minutesWaiting,
      threadUrl: `${input.appUrl.replace(/\/$/, '')}/${row.localeDefault}/${row.slug}/console/conversations/${input.threadId}`,
    }

    // The owner's phones, on the first messaging channel the property has on:
    // WhatsApp, else SMS (ADR-035). Numbers come only from `ownerPhones`, the
    // same recorded list that gates the owner agent.
    const phoneChannel = await phoneChannelFor(db, input.propertyId)
    const phones = phoneChannel ? readPhones(row.settings, 'ownerPhones') : []

    if (!contact && phones.length === 0) return null

    return db.transaction(async (tx) => {
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
      const email = contact
        ? await queueNotification(tx, {
            propertyId: input.propertyId,
            channel: 'email',
            template: ESCALATION_ALERT,
            locale: row.localeDefault,
            recipient: contact,
            payload,
          })
        : null

      let first: string | null = null
      for (const phone of phones) {
        const id = await queueNotification(tx, {
          propertyId: input.propertyId,
          channel: phoneChannel!,
          template: ESCALATION_ALERT,
          locale: row.localeDefault,
          recipient: phone,
          payload,
        })
        first ??= id
      }

      return email ?? first
    })
  })
}

/**
 * The first messaging channel the property has on: WhatsApp, else SMS, else
 * none (ADR-035). Shared by every alert that reaches a phone.
 */
export async function phoneChannelFor(
  db: Pick<Parameters<Parameters<typeof asService>[0]>[0], 'execute'>,
  propertyId: string,
): Promise<'whatsapp' | 'sms' | null> {
  const [channels] = await db.execute<{ whatsapp: boolean; sms: boolean }>(sql`
    select exists (select 1 from entitlements where property_id = ${propertyId}
                    and feature = 'whatsapp' and ended_at is null) as whatsapp,
           exists (select 1 from entitlements where property_id = ${propertyId}
                    and feature = 'sms' and ended_at is null) as sms`)
  return channels?.whatsapp ? 'whatsapp' : channels?.sms ? 'sms' : null
}

/**
 * A phone list from settings (`ownerPhones`, `staffPhones`) as E.164; anything
 * without a country code is dropped rather than guessed at.
 */
export function readPhones(settings: unknown, key: 'ownerPhones' | 'staffPhones'): string[] {
  const raw = (settings as Record<string, unknown> | null)?.[key]
  if (!Array.isArray(raw)) return []
  const phones = raw
    .map((value) => String(value).trim())
    .filter((value) => value.startsWith('+'))
    .map((value) => `+${value.replace(/\D/g, '')}`)
    .filter((value) => /^\+[1-9]\d{6,14}$/.test(value))
  return [...new Set(phones)]
}
