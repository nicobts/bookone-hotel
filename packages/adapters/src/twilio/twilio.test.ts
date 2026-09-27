import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearNotificationProviders,
  registerNotificationProvider,
} from '@bookone/core/notifications'
import {
  parseInbound,
  parseStatus,
  TwilioClient,
  TwilioError,
  TwilioNotificationProvider,
  twilioSignature,
  verifyTwilioSignature,
} from './index'

const SID = 'SM' + 'a'.repeat(32)
const ACCOUNT = 'AC' + 'b'.repeat(32)

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  )
}

describe('signature', () => {
  const url = 'https://api.example.test/webhooks/twilio/inbound'
  const params = { MessageSid: SID, From: 'whatsapp:+393331234567', Body: 'Ciao' }

  it('accepts its own signature regardless of parameter order', () => {
    const signature = twilioSignature(url, params, 'token')
    const reordered = { Body: 'Ciao', MessageSid: SID, From: 'whatsapp:+393331234567' }
    expect(verifyTwilioSignature({ url, params: reordered, signature, authToken: 'token' })).toBe(
      true,
    )
  })

  it('refuses a changed body, URL, token or a missing header', () => {
    const signature = twilioSignature(url, params, 'token')
    const check = (over: Partial<Parameters<typeof verifyTwilioSignature>[0]>) =>
      verifyTwilioSignature({ url, params, signature, authToken: 'token', ...over })

    expect(check({ params: { ...params, Body: 'Ciao!' } })).toBe(false)
    expect(check({ url: url + '?x=1' })).toBe(false)
    expect(check({ authToken: 'other' })).toBe(false)
    expect(check({ signature: null })).toBe(false)
    expect(check({ signature: 'short' })).toBe(false)
  })
})

describe('parseInbound', () => {
  it('reads a WhatsApp message and strips the prefix', () => {
    expect(
      parseInbound({
        MessageSid: SID,
        From: 'whatsapp:+393331234567',
        To: 'whatsapp:+390400000000',
        Body: 'A che ora è la colazione?',
        ProfileName: 'dropped',
        NumMedia: '0',
      }),
    ).toEqual({
      messageSid: SID,
      channel: 'whatsapp',
      from: '+393331234567',
      to: '+390400000000',
      body: 'A che ora è la colazione?',
      media: 0,
    })
  })

  it('reads SMS, and refuses what cannot be attributed', () => {
    expect(
      parseInbound({ MessageSid: SID, From: '+393331234567', To: '+390400000000', Body: 'x' })
        ?.channel,
    ).toBe('sms')
    expect(
      parseInbound({ MessageSid: 'nope', From: '+393331234567', To: '+390400000000' }),
    ).toBeNull()
    expect(parseInbound({ MessageSid: SID, From: 'garbage', To: '+390400000000' })).toBeNull()
    // Mixed channels are not a real delivery.
    expect(
      parseInbound({ MessageSid: SID, From: 'whatsapp:+393331234567', To: '+390400000000' }),
    ).toBeNull()
  })
})

describe('parseStatus', () => {
  it('marks final states', () => {
    expect(parseStatus({ MessageSid: SID, MessageStatus: 'sent' })?.final).toBe(false)
    expect(parseStatus({ MessageSid: SID, MessageStatus: 'delivered' })?.final).toBe(true)
    expect(parseStatus({ MessageSid: SID, MessageStatus: 'failed', ErrorCode: '63016' })).toEqual({
      messageSid: SID,
      status: 'failed',
      final: true,
      errorCode: '63016',
    })
  })
})

describe('TwilioClient', () => {
  it('sends to the regional host with basic auth and a template when given', async () => {
    const fetch = fakeFetch(201, { sid: SID, status: 'queued' })
    const client = new TwilioClient({ accountSid: ACCOUNT, authToken: 't', region: 'ie1', fetch })

    await client.sendMessage({
      from: 'whatsapp:+390400000000',
      to: 'whatsapp:+393331234567',
      contentSid: 'HX123',
      contentVariables: { '1': 'Hotel Demo' },
    })

    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe(
      `https://api.dublin.ie1.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`,
    )
    const form = new URLSearchParams(String(init!.body))
    expect(form.get('ContentSid')).toBe('HX123')
    expect(form.get('Body')).toBeNull()
    expect(JSON.parse(form.get('ContentVariables')!)).toEqual({ '1': 'Hotel Demo' })
    expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
  })

  it('raises a typed error, retryable only for 429 and 5xx', async () => {
    const client = (status: number) =>
      new TwilioClient({
        accountSid: ACCOUNT,
        authToken: 't',
        fetch: fakeFetch(status, { message: 'nope', code: 21211 }),
      })

    const bad = await client(400)
      .sendMessage({ from: '+1', to: '+2', body: 'x' })
      .catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(TwilioError)
    expect((bad as TwilioError).retryable).toBe(false)
    expect((bad as TwilioError).code).toBe(21211)

    const busy = await client(503)
      .sendMessage({ from: '+1', to: '+2', body: 'x' })
      .catch((e: unknown) => e)
    expect((busy as TwilioError).retryable).toBe(true)
  })

  it('treats a message already gone as deleted', async () => {
    const client = new TwilioClient({
      accountSid: ACCOUNT,
      authToken: 't',
      fetch: fakeFetch(404, {}),
    })
    await expect(client.deleteMessage(SID)).resolves.toBeUndefined()
    await expect(client.deleteMessage('../../Calls')).rejects.toThrow(/not a message SID/)
  })
})

describe('TwilioNotificationProvider', () => {
  afterEach(() => clearNotificationProviders())

  const provider = (fetch = fakeFetch(201, { sid: SID })) =>
    new TwilioNotificationProvider({
      client: new TwilioClient({ accountSid: ACCOUNT, authToken: 't', fetch }),
      region: 'ie1',
      whatsappFrom: '+390400000000',
      webhookBaseUrl: 'https://api.example.test/',
    })

  it('passes the residency gate only through the ADR-035 exception', () => {
    expect(() => registerNotificationProvider(provider())).not.toThrow()

    const noException = provider()
    delete (noException.residency as { transferException?: string }).transferException
    expect(() => registerNotificationProvider(noException)).toThrow(/EU processing/)

    const noEntry = provider()
    ;(noEntry.residency as { subProcessorRegisterEntry: string }).subProcessorRegisterEntry =
      'SP-999'
    expect(() => registerNotificationProvider(noEntry)).toThrow(/does not exist/)
  })

  it('offers only the channels it has a sender for', async () => {
    expect(provider().channels).toEqual(['whatsapp'])
    await expect(
      provider().send({
        channel: 'sms',
        to: '+393331234567',
        subject: null,
        body: 'x',
        locale: 'it',
      }),
    ).rejects.toThrow(/does not send on sms/)
  })

  it('sends WhatsApp with the prefix and a status callback, and returns the SID', async () => {
    const fetch = fakeFetch(201, { sid: SID })
    const result = await provider(fetch).send({
      channel: 'whatsapp',
      to: '+393331234567',
      subject: null,
      body: 'Buongiorno',
      locale: 'it',
    })
    expect(result.providerMessageId).toBe(SID)
    const form = new URLSearchParams(String(fetch.mock.calls[0]![1]!.body))
    expect(form.get('To')).toBe('whatsapp:+393331234567')
    expect(form.get('From')).toBe('whatsapp:+390400000000')
    expect(form.get('Body')).toBe('Buongiorno')
    expect(form.get('StatusCallback')).toBe('https://api.example.test/webhooks/twilio/status')
  })
})
