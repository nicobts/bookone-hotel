import { sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'

/**
 * Replies that still have to reach a guest on WhatsApp or SMS (ADR-035).
 *
 * The thread in our database is the conversation; the channel is a delivery
 * route for it. A reply is "pending" when it is on a WhatsApp/SMS thread,
 * written by anyone but the guest (the concierge, a person, the product), since
 * the guest's last message, and not yet linked to a provider message in
 * `external_refs`. That one definition covers every writer — the concierge's
 * answer, a staff reply from the console, the "someone will reply here" of a
 * paused concierge, an approval decided an hour later — without any of them
 * knowing a channel exists.
 *
 * WhatsApp allows free text only within 24 hours of the guest's last message.
 * Past that, a reply needs an approved template, so it is reported as
 * `outside-window` rather than sent and silently refused.
 */
export const WHATSAPP_WINDOW_HOURS = 24

export interface PendingReply {
  messageId: string
  body: string
  author: 'agent' | 'staff' | 'system'
}

export interface ChannelTarget {
  channel: 'whatsapp' | 'sms'
  /** E.164, the guest's number on the reservation. */
  to: string
  withinWindow: boolean
}

export async function channelTarget(
  propertyId: string,
  threadId: string,
): Promise<ChannelTarget | null> {
  const [row] = await asService((db) =>
    db.execute<{ channel: string; phone: string | null; within: boolean }>(sql`
      select t.channel::text as channel, g.phone,
             coalesce(t.last_guest_message_at > now() - make_interval(hours => ${WHATSAPP_WINDOW_HOURS}), false) as within
        from message_threads t
        join reservations r on r.id = t.reservation_id and r.property_id = t.property_id
        join guests g on g.id = r.guest_id and g.property_id = r.property_id
       where t.id = ${threadId} and t.property_id = ${propertyId}
       limit 1`),
  )
  if (!row || (row.channel !== 'whatsapp' && row.channel !== 'sms')) return null
  const digits = (row.phone ?? '').replace(/\D/g, '')
  const phone = row.phone?.trim().startsWith('+')
    ? `+${digits}`
    : digits.startsWith('00')
      ? `+${digits.slice(2)}`
      : null
  if (!phone) return null
  return {
    channel: row.channel,
    to: phone,
    withinWindow: row.channel === 'sms' || row.within,
  }
}

export async function pendingReplies(
  propertyId: string,
  threadId: string,
  provider: string,
): Promise<PendingReply[]> {
  const rows = await asService((db) =>
    db.execute<{ id: string; body: string; author: PendingReply['author'] }>(sql`
      select m.id, m.body, m.author::text as author
        from messages m
        join message_threads t on t.id = m.thread_id
       where m.thread_id = ${threadId}
         and m.property_id = ${propertyId}
         and t.channel in ('whatsapp', 'sms')
         and m.author <> 'guest'
         and m.created_at >= coalesce(t.last_guest_message_at, 'infinity'::timestamptz)
         and not exists (
           select 1 from external_refs x
            where x.property_id = m.property_id and x.system = ${provider}
              and x.entity_type = 'message' and x.entity_id = m.id
         )
       order by m.created_at, m.id`),
  )
  return [...rows].map((r) => ({ messageId: r.id, body: r.body, author: r.author }))
}

/** Link a message to the provider message that carried it; idempotent. */
export async function recordDelivery(input: {
  propertyId: string
  threadId: string
  messageId: string
  provider: string
  providerMessageId: string
  channel: 'whatsapp' | 'sms'
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(externalRefs)
        .values({
          propertyId: input.propertyId,
          system: input.provider,
          entityType: 'message',
          entityId: input.messageId,
          externalId: input.providerMessageId,
          lastSyncedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: externalRefs.id })
      if (inserted.length === 0) return

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'message.dispatched',
        origin: 'platform',
        actor: systemActor,
        payload: { messageId: input.messageId, channel: input.channel, provider: input.provider },
      })
    }),
  )
}

/**
 * Threads with replies still to deliver, across properties, for the sweep.
 * Filtered by the channel's feature in the query itself, so a property with
 * WhatsApp switched off never reaches the provider (ADR-019).
 */
export async function threadsWithPendingReplies(
  provider: string,
  limit = 50,
): Promise<{ propertyId: string; threadId: string }[]> {
  const rows = await asService((db) =>
    db.execute<{ property_id: string; thread_id: string }>(sql`
      select distinct t.property_id, t.id as thread_id
        from message_threads t
        join messages m on m.thread_id = t.id
       where t.channel in ('whatsapp', 'sms')
         -- The channel's own feature, live (ADR-019). Inline rather than
         -- hasFeatureSql because this query aliases the thread table.
         and exists (select 1 from entitlements e
                      where e.property_id = t.property_id and e.ended_at is null
                        and e.feature = t.channel::text)
         and m.author <> 'guest'
         and m.created_at >= coalesce(t.last_guest_message_at, 'infinity'::timestamptz)
         and m.created_at > now() - interval '2 days'
         and not exists (
           select 1 from external_refs x
            where x.property_id = m.property_id and x.system = ${provider}
              and x.entity_type = 'message' and x.entity_id = m.id
         )
       limit ${limit}`),
  )
  return [...rows].map((r) => ({ propertyId: r.property_id, threadId: r.thread_id }))
}

/**
 * A reply the provider refused for good — a number not on WhatsApp, a blocked
 * sender. Recorded so the sweep stops offering it (a `failed:` reference is not
 * a provider id, and never collides with one), and evented so the console's
 * history shows the guest did not receive it.
 */
export async function recordDeliveryFailure(input: {
  propertyId: string
  threadId: string
  messageId: string
  provider: string
  channel: 'whatsapp' | 'sms'
  reason: string
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(externalRefs)
        .values({
          propertyId: input.propertyId,
          system: input.provider,
          entityType: 'message',
          entityId: input.messageId,
          externalId: `failed:${input.messageId}`,
          lastSyncedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: externalRefs.id })
      if (inserted.length === 0) return

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'message_thread',
        entityId: input.threadId,
        eventType: 'message.dispatch_failed',
        origin: 'platform',
        actor: systemActor,
        payload: { messageId: input.messageId, channel: input.channel, reason: input.reason },
      })
    }),
  )
}

/** Name and slug, for the fixed reply to an unmatched sender. */
export async function getPropertyBasics(
  propertyId: string,
): Promise<{ name: string; slug: string } | null> {
  const [row] = await asService((db) =>
    db.execute<{ name: string; slug: string }>(
      sql`select name, slug from properties where id = ${propertyId} limit 1`,
    ),
  )
  return row ? { name: row.name, slug: row.slug } : null
}
