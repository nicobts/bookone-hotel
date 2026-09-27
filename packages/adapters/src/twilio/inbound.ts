/**
 * Twilio's inbound and status webhooks, reduced to what the platform uses.
 * Everything else Twilio sends (profile names, geo fields, media) is dropped
 * here, so it never reaches a log, a job payload or the database.
 */
export type TwilioChannel = 'whatsapp' | 'sms'

export interface InboundMessage {
  messageSid: string
  channel: TwilioChannel
  /** E.164, without the `whatsapp:` prefix. */
  from: string
  /** The number the guest wrote to — it selects the property. */
  to: string
  body: string
  /** Count only: media is not accepted on this channel yet. */
  media: number
}

const E164 = /^\+[1-9]\d{6,14}$/

function strip(address: string): { channel: TwilioChannel; number: string } {
  const whatsapp = address.startsWith('whatsapp:')
  return {
    channel: whatsapp ? 'whatsapp' : 'sms',
    number: whatsapp ? address.slice('whatsapp:'.length) : address,
  }
}

/** Null when the payload is not a message we can attribute. */
export function parseInbound(params: Record<string, string>): InboundMessage | null {
  const sid = params.MessageSid ?? params.SmsSid
  if (!sid || !/^[SM]M[0-9a-f]{32}$/i.test(sid)) return null

  const from = strip(params.From ?? '')
  const to = strip(params.To ?? '')
  if (!E164.test(from.number) || !E164.test(to.number)) return null
  if (from.channel !== to.channel) return null

  return {
    messageSid: sid,
    channel: from.channel,
    from: from.number,
    to: to.number,
    // WhatsApp caps a message at 4096 characters; anything longer is not a guest.
    body: (params.Body ?? '').slice(0, 4096),
    media: Number.parseInt(params.NumMedia ?? '0', 10) || 0,
  }
}

export interface StatusUpdate {
  messageSid: string
  status: string
  /** Delivered, read, failed or undelivered: nothing more will happen to it. */
  final: boolean
  errorCode: string | null
}

const FINAL = new Set(['delivered', 'read', 'failed', 'undelivered', 'canceled'])

export function parseStatus(params: Record<string, string>): StatusUpdate | null {
  const sid = params.MessageSid
  const status = params.MessageStatus
  if (!sid || !status || !/^[SM]M[0-9a-f]{32}$/i.test(sid)) return null
  return {
    messageSid: sid,
    status,
    final: FINAL.has(status),
    errorCode: params.ErrorCode ?? null,
  }
}

/** Twilio's address form for a channel. */
export function address(channel: TwilioChannel, number: string): string {
  return channel === 'whatsapp' ? `whatsapp:${number}` : number
}
