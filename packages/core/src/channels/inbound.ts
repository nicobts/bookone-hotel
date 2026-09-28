import { and, eq, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { externalRefs } from '../db/schema'
import { appendGuestMessage } from '../concierge/thread'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { isEntitled } from '../onboarding/entitlements'
import { contactPhones } from '../contacts'

/**
 * Who an inbound WhatsApp or SMS message belongs to (ADR-035).
 *
 * Identity comes from recorded data only, never from anything the sender
 * says about themselves:
 *
 *   1. the number written **to** selects the property
 *      (`settings.whatsappNumber` / `settings.smsNumber`);
 *   2. a sender among the property's `owner` contacts (`property_contacts`) is
 *      the owner — the only path to the owner agent, as before;
 *   3. a sender whose number is a guest's on a current stay is that guest, and
 *      the message joins the stay's thread;
 *   4. anyone else is unknown and gets a fixed reply.
 *
 * Phones match **exactly**, as E.164 digits. A stored number without a country
 * code matches nothing: guessing "+39" would, one day, put a stranger's
 * message into someone else's stay.
 *
 * Every path records the provider's message id, so a redelivered webhook is
 * recognised and changes nothing.
 */
export type InboundChannel = 'whatsapp' | 'sms'

export interface InboundInput {
  channel: InboundChannel
  /** The provider's message id — the idempotency key. */
  providerMessageId: string
  provider: string
  /** E.164. */
  from: string
  to: string
  body: string
  receivedAt?: Date
}

export type InboundRoute =
  | { kind: 'no-property' }
  /** The property exists but has this channel switched off (ADR-019). */
  | { kind: 'channel-off'; propertyId: string }
  | { kind: 'duplicate'; propertyId: string }
  | { kind: 'owner'; propertyId: string; phone: string; locale: string }
  | {
      kind: 'guest'
      propertyId: string
      reservationId: string
      threadId: string
      messageId: string
      locale: string
    }
  | { kind: 'unknown'; propertyId: string; locale: string }
  /** More than one property records the number written to. Not routed. */
  | { kind: 'ambiguous-number' }

/** `+39 333 123 4567` → `+393331234567`; `0039…` → `+39…`; anything else → null. */
export function normalisePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return digits.length >= 7 ? `+${digits}` : null
  if (digits.startsWith('00')) return digits.length >= 9 ? `+${digits.slice(2)}` : null
  return null
}

/** How long around a stay the guest's number still reaches it. */
const BEFORE_ARRIVAL_DAYS = 14
const AFTER_DEPARTURE_DAYS = 2

export async function routeInboundMessage(input: InboundInput): Promise<InboundRoute> {
  const to = normalisePhone(input.to)
  const from = normalisePhone(input.from)
  if (!to || !from) return { kind: 'no-property' }

  const numberKey = input.channel === 'whatsapp' ? 'whatsappNumber' : 'smsNumber'

  const matches = await asService((db) =>
    db.execute<{ id: string; default_locale: string | null }>(sql`
      select id, locale_default as default_locale
        from properties
       where '+' || regexp_replace(coalesce(settings->>${numberKey}, ''), '\\D', '', 'g') = ${to}
       limit 2`),
  )
  /*
   * One number, one property. With two properties recording the same number,
   * whichever row came first would decide, and the other property's owner and
   * guests would be matched against the wrong lists. Nothing is routed until
   * the configuration is fixed; the admin console refuses to create it.
   */
  if (matches.length > 1) return { kind: 'ambiguous-number' }
  const [property] = matches
  if (!property) return { kind: 'no-property' }
  const propertyId = property.id

  // Off means unreachable: nothing is stored, nothing is answered.
  if (!(await isEntitled(propertyId, input.channel))) return { kind: 'channel-off', propertyId }

  const ownerPhones = await asService((db) => contactPhones(db, propertyId, 'owner'))

  if (ownerPhones.includes(from)) {
    const fresh = await recordNonGuest(input, propertyId, 'owner_message')
    return fresh
      ? { kind: 'owner', propertyId, phone: from, locale: property.default_locale ?? 'it' }
      : { kind: 'duplicate', propertyId }
  }

  const [stay] = await asService((db) =>
    db.execute<{ reservation_id: string; locale: string | null }>(sql`
      select r.id as reservation_id, g.locale
        from reservations r
        join guests g on g.id = r.guest_id and g.property_id = r.property_id
       where r.property_id = ${propertyId}
         and r.status = 'confirmed'
         and '+' || regexp_replace(coalesce(g.phone, ''), '\\D', '', 'g') = ${from}
         and (g.phone like '+%' or g.phone like '00%')
         and current_date between r.arrival_date - ${BEFORE_ARRIVAL_DAYS}::int
                              and r.departure_date + ${AFTER_DEPARTURE_DAYS}::int
       order by abs(r.arrival_date - current_date)
       limit 1`),
  )

  if (stay) {
    const locale = stay.locale ?? property.default_locale ?? 'it'
    const result = await appendGuestMessage({
      propertyId,
      reservationId: stay.reservation_id,
      locale,
      body: input.body,
      channel: input.channel,
      externalRef: { system: input.provider, externalId: input.providerMessageId },
      ...(input.receivedAt ? { at: input.receivedAt } : {}),
    })
    if (result.duplicate) return { kind: 'duplicate', propertyId }
    return {
      kind: 'guest',
      propertyId,
      reservationId: stay.reservation_id,
      threadId: result.thread.id,
      messageId: result.messageId,
      locale: result.thread.locale,
    }
  }

  const fresh = await recordNonGuest(input, propertyId, 'unknown_message')
  return fresh
    ? { kind: 'unknown', propertyId, locale: property.default_locale ?? 'it' }
    : { kind: 'duplicate', propertyId }
}

/**
 * A message that joins no thread still gets its idempotency record and an
 * event — without the body or the sender's number, which there is no reason
 * to keep for a message we did not act on as a conversation.
 */
async function recordNonGuest(
  input: InboundInput,
  propertyId: string,
  entityType: 'owner_message' | 'unknown_message',
): Promise<boolean> {
  return asService((db) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(externalRefs)
        .values({
          propertyId,
          system: input.provider,
          entityType,
          // No row of ours stands for this message; the property is the entity.
          entityId: propertyId,
          externalId: input.providerMessageId,
          lastSyncedAt: input.receivedAt ?? new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: externalRefs.id })

      if (inserted.length === 0) return false

      await emit(tx, {
        propertyId,
        entityType: 'property',
        entityId: propertyId,
        eventType:
          entityType === 'owner_message' ? 'owner_message.received' : 'channel_message.unmatched',
        origin: 'platform',
        actor: systemActor,
        payload: { channel: input.channel, provider: input.provider },
      })
      return true
    }),
  )
}

/** For a delivery-status callback: the message this provider id belongs to, if any. */
export async function findMessageByProviderId(
  provider: string,
  providerMessageId: string,
): Promise<{ propertyId: string; entityId: string; entityType: string } | null> {
  const [row] = await asService((db) =>
    db
      .select({
        propertyId: externalRefs.propertyId,
        entityId: externalRefs.entityId,
        entityType: externalRefs.entityType,
      })
      .from(externalRefs)
      .where(and(eq(externalRefs.system, provider), eq(externalRefs.externalId, providerMessageId)))
      .limit(1),
  )
  return row ?? null
}
