import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, db } from '../../client'
import {
  channelTarget,
  pendingReplies,
  recordDelivery,
  recordDeliveryFailure,
  routeInboundMessage,
  threadsWithPendingReplies,
  type InboundInput,
} from '../../../channels'
import { appendSystemMessage } from '../../../concierge/thread'
import { alertEscalation } from '../../../concierge/alerts'
import { sendNotification, type NotificationProvider } from '../../../notifications'

/**
 * WhatsApp/SMS routing and delivery against a real database (ADR-035).
 *
 * The claims that matter fail silently when wrong: a message filed into the
 * wrong stay, a redelivered webhook answered twice, a reply sent on a channel
 * the property switched off. Own property, removed at the end.
 */
const slug = `channels-${randomUUID().slice(0, 8)}`
const HOTEL = '+390409990001'
const GUEST = '+393339990002'
const OWNER = '+393339990003'
const today = new Date()
const day = (offset: number) =>
  new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10)

let propertyId: string
let reservationId: string

let counter = 0
function message(over: Partial<InboundInput> = {}): InboundInput {
  counter += 1
  return {
    channel: 'whatsapp',
    provider: 'twilio',
    providerMessageId: `SM${String(counter).padStart(32, '0')}`,
    from: GUEST,
    to: HOTEL,
    body: 'A che ora è la colazione?',
    ...over,
  }
}

beforeAll(async () => {
  const [property] = await db.execute<{ id: string }>(sql`
    insert into properties (slug, name, settings)
    values (${slug}, 'Channels Test',
            jsonb_build_object('whatsappNumber', '+39 040 999 0001', 'ownerPhones', jsonb_build_array(${OWNER}::text)))
    returning id`)
  propertyId = property!.id

  const [roomType] = await db.execute<{ id: string }>(
    sql`insert into room_types (property_id, code, capacity) values (${propertyId}, 'DBL', 2) returning id`,
  )
  const [guest] = await db.execute<{ id: string }>(sql`
    insert into guests (property_id, name, phone, locale)
    values (${propertyId}, 'Eva Test', '+39 333 999 0002', 'it') returning id`)
  // A second guest whose number has no country code: it must match nothing.
  const [local] = await db.execute<{ id: string }>(sql`
    insert into guests (property_id, name, phone, locale)
    values (${propertyId}, 'Local Test', '3339990004', 'it') returning id`)

  const [reservation] = await db.execute<{ id: string }>(sql`
    insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date, status, pax)
    values (${propertyId}, ${guest!.id}, ${roomType!.id}, ${day(1)}, ${day(4)}, 'confirmed', '{"adults":2}'::jsonb)
    returning id`)
  reservationId = reservation!.id
  await db.execute(sql`
    insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date, status, pax)
    values (${propertyId}, ${local!.id}, ${roomType!.id}, ${day(1)}, ${day(3)}, 'confirmed', '{"adults":1}'::jsonb)`)
})

afterAll(async () => {
  await db.execute(sql`delete from domain_events where property_id = ${propertyId}`)
  await db.execute(sql`delete from properties where id = ${propertyId}`)
  await closeConnection()
})

describe('routing an inbound message', () => {
  it('answers nothing for a number no property owns, or a channel that is off', async () => {
    expect(await routeInboundMessage(message({ to: '+390000000000' }))).toEqual({
      kind: 'no-property',
    })
    expect(await routeInboundMessage(message())).toEqual({ kind: 'channel-off', propertyId })

    await db.execute(
      sql`insert into entitlements (property_id, feature) values (${propertyId}, 'whatsapp')`,
    )
  })

  it('files a guest message into their stay, once, and remembers the channel', async () => {
    const first = message()
    const route = await routeInboundMessage(first)
    expect(route).toMatchObject({ kind: 'guest', propertyId, reservationId, locale: 'it' })

    // Twilio redelivers: recognised, nothing added.
    expect(await routeInboundMessage(first)).toEqual({ kind: 'duplicate', propertyId })

    const [thread] = await db.execute<{ channel: string; messages: number }>(sql`
      select t.channel::text as channel,
             (select count(*)::int from messages m where m.thread_id = t.id) as messages
        from message_threads t where t.reservation_id = ${reservationId}`)
    expect(thread).toEqual({ channel: 'whatsapp', messages: 1 })
  })

  it('sends the owner number to the owner, and a stranger nowhere', async () => {
    const owner = message({ from: OWNER })
    expect(await routeInboundMessage(owner)).toMatchObject({
      kind: 'owner',
      propertyId,
      phone: OWNER,
    })
    expect(await routeInboundMessage(owner)).toEqual({ kind: 'duplicate', propertyId })

    expect(await routeInboundMessage(message({ from: '+447700900123' }))).toMatchObject({
      kind: 'unknown',
      propertyId,
    })
  })

  it('never guesses a country code for a stored local number', async () => {
    expect(await routeInboundMessage(message({ from: '+393339990004' }))).toMatchObject({
      kind: 'unknown',
    })
  })
})

describe('delivering replies', () => {
  async function threadId(): Promise<string> {
    const [row] = await db.execute<{ id: string }>(
      sql`select id from message_threads where reservation_id = ${reservationId}`,
    )
    return row!.id
  }

  it('targets the guest’s number inside the window', async () => {
    expect(await channelTarget(propertyId, await threadId())).toEqual({
      channel: 'whatsapp',
      to: GUEST,
      withinWindow: true,
    })
  })

  it('offers each reply once, until it is delivered or refused for good', async () => {
    const thread = await threadId()
    expect(await pendingReplies(propertyId, thread, 'twilio')).toEqual([])

    const first = await appendSystemMessage({ propertyId, threadId: thread, body: 'Uno' })
    const second = await appendSystemMessage({ propertyId, threadId: thread, body: 'Due' })

    expect((await pendingReplies(propertyId, thread, 'twilio')).map((r) => r.body)).toEqual([
      'Uno',
      'Due',
    ])
    expect(await threadsWithPendingReplies('twilio', 500)).toContainEqual({
      propertyId,
      threadId: thread,
    })

    await recordDelivery({
      propertyId,
      threadId: thread,
      messageId: first,
      provider: 'twilio',
      providerMessageId: 'SM' + 'd'.repeat(32),
      channel: 'whatsapp',
    })
    await recordDeliveryFailure({
      propertyId,
      threadId: thread,
      messageId: second,
      provider: 'twilio',
      channel: 'whatsapp',
      reason: 'not a WhatsApp user',
    })

    expect(await pendingReplies(propertyId, thread, 'twilio')).toEqual([])
    const [events] = await db.execute<{ dispatched: number; failed: number }>(sql`
      select count(*) filter (where event_type = 'message.dispatched')::int as dispatched,
             count(*) filter (where event_type = 'message.dispatch_failed')::int as failed
        from domain_events where property_id = ${propertyId}`)
    expect(events).toEqual({ dispatched: 1, failed: 1 })
  })

  it('stops offering anything once the property switches WhatsApp off', async () => {
    const thread = await threadId()
    await appendSystemMessage({ propertyId, threadId: thread, body: 'Tre' })
    expect(await threadsWithPendingReplies('twilio', 500)).toContainEqual({
      propertyId,
      threadId: thread,
    })

    await db.execute(sql`
      update entitlements set ended_at = now()
       where property_id = ${propertyId} and feature = 'whatsapp' and ended_at is null`)
    expect(await threadsWithPendingReplies('twilio', 500)).not.toContainEqual({
      propertyId,
      threadId: thread,
    })
  })
})

describe('the owner hears about a handover on their phone (plan §4, ADR-035)', () => {
  async function threadId(): Promise<string> {
    const [row] = await db.execute<{ id: string }>(
      sql`select id from message_threads where reservation_id = ${reservationId}`,
    )
    return row!.id
  }

  const fake = (name: string, channels: NotificationProvider['channels']) => {
    const sent: Parameters<NotificationProvider['send']>[0][] = []
    const provider: NotificationProvider = {
      name,
      channels,
      residency: {
        euProcessing: true,
        region: 'test',
        subProcessorRegisterEntry: 'none',
        verifiedAt: '2026-09-27',
      },
      send: async (message) => {
        sent.push(message)
        return { providerMessageId: `${name}-1` }
      },
    }
    return { provider, sent }
  }

  it('queues the owner’s phone, and no email, at the moment of handover', async () => {
    await db.execute(
      sql`insert into entitlements (property_id, feature) values (${propertyId}, 'whatsapp')`,
    )
    const id = await alertEscalation({
      propertyId,
      reservationId,
      threadId: await threadId(),
      escalatedAt: new Date(),
      appUrl: 'http://app.test',
      reach: 'phone',
    })
    expect(id).not.toBeNull()

    const rows = await db.execute<{ channel: string; recipient: string }>(sql`
      select channel::text as channel, recipient from notifications
       where property_id = ${propertyId} and template = 'stay.escalation-alert'`)
    expect([...rows]).toEqual([{ channel: 'whatsapp', recipient: OWNER }])
  })

  it('sends it through the messaging provider, as the approved template', async () => {
    const email = fake('email', ['email'])
    const phone = fake('twilio', ['whatsapp', 'sms'])
    const [row] = await db.execute<{ id: string }>(sql`
      select id from notifications where property_id = ${propertyId} and channel = 'whatsapp'`)

    const outcome = await sendNotification(
      {
        provider: email.provider,
        providers: [phone.provider],
        templateIds: { 'stay.escalation-alert': 'HX123' },
      },
      { notificationId: row!.id },
    )

    expect(outcome).toEqual({ status: 'sent', providerMessageId: 'twilio-1' })
    expect(email.sent).toEqual([])
    expect(phone.sent[0]).toMatchObject({
      channel: 'whatsapp',
      to: OWNER,
      template: { id: 'HX123', variables: { '1': 'Eva Test' } },
    })
    // The text we keep is the short phone form: who is waiting and the link.
    expect(phone.sent[0]!.body).toContain('/console/conversations/')
    expect(phone.sent[0]!.body).not.toContain('0 ')
  })

  it('reaches no phone when the property has no messaging channel on', async () => {
    await db.execute(sql`
      update entitlements set ended_at = now()
       where property_id = ${propertyId} and feature = 'whatsapp' and ended_at is null`)
    expect(
      await alertEscalation({
        propertyId,
        reservationId,
        threadId: await threadId(),
        escalatedAt: new Date(),
        appUrl: 'http://app.test',
        reach: 'phone',
      }),
    ).toBeNull()
  })
})
