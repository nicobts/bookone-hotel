/**
 * The smallest Twilio Messaging client this platform needs (ADR-035): send a
 * message, delete one. Plain `fetch` rather than the `twilio` package — two
 * REST calls do not justify a dependency and its transitive tree.
 *
 * ## Region
 *
 * `ie1` sends to Twilio's Ireland region, which keeps Twilio's processing and
 * its message log in the EU. Credentials are per region: an IE1 request needs
 * an auth token (or API key) created in IE1, not the US1 one.
 */
export type TwilioRegion = 'us1' | 'ie1'

export interface TwilioClientOptions {
  accountSid: string
  authToken: string
  region?: TwilioRegion
  fetch?: typeof fetch
}

export interface SendMessageInput {
  /** `+39…` for SMS, `whatsapp:+39…` for WhatsApp. */
  from: string
  to: string
  /** Free text; allowed on WhatsApp only inside the 24-hour window. */
  body?: string
  /** An approved WhatsApp template (Twilio Content SID), for outside the window. */
  contentSid?: string
  contentVariables?: Record<string, string>
  statusCallback?: string
}

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Twilio's numeric error code, when it sent one. */
    readonly code: number | null,
  ) {
    super(message)
    this.name = 'TwilioError'
  }

  /** 429 and 5xx are worth retrying; a 4xx will fail the same way again. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

const HOSTS: Record<TwilioRegion, string> = {
  us1: 'https://api.twilio.com',
  ie1: 'https://api.dublin.ie1.twilio.com',
}

export class TwilioClient {
  private readonly base: string
  private readonly auth: string
  private readonly fetchImpl: typeof fetch

  constructor(options: TwilioClientOptions) {
    if (!options.accountSid.startsWith('AC'))
      throw new Error('TWILIO_ACCOUNT_SID must start with AC')
    if (!options.authToken) throw new Error('TWILIO_AUTH_TOKEN is required')
    this.base = `${HOSTS[options.region ?? 'us1']}/2010-04-01/Accounts/${options.accountSid}`
    this.auth = `Basic ${Buffer.from(`${options.accountSid}:${options.authToken}`).toString('base64')}`
    this.fetchImpl = options.fetch ?? fetch
  }

  async sendMessage(input: SendMessageInput): Promise<{ sid: string; status: string }> {
    if (!input.body && !input.contentSid) throw new Error('a message needs a body or a template')

    const form = new URLSearchParams({ From: input.from, To: input.to })
    if (input.contentSid) {
      form.set('ContentSid', input.contentSid)
      if (input.contentVariables) {
        form.set('ContentVariables', JSON.stringify(input.contentVariables))
      }
    } else if (input.body) {
      form.set('Body', input.body)
    }
    if (input.statusCallback) form.set('StatusCallback', input.statusCallback)

    const res = await this.fetchImpl(`${this.base}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    })
    const json = (await res.json().catch(() => ({}))) as {
      sid?: string
      status?: string
      message?: string
      code?: number
    }
    if (!res.ok || !json.sid) {
      throw new TwilioError(
        `Twilio send failed: ${json.message ?? res.statusText}`,
        res.status,
        json.code ?? null,
      )
    }
    return { sid: json.sid, status: json.status ?? 'queued' }
  }

  /**
   * Remove a message, body included, from Twilio's log (ADR-035). A message
   * that is already gone counts as deleted: the redelivery of a status
   * callback must not turn into an error.
   */
  async deleteMessage(sid: string): Promise<void> {
    if (!/^[SM]M[0-9a-f]{32}$/i.test(sid)) throw new Error(`not a message SID: ${sid}`)
    const res = await this.fetchImpl(`${this.base}/Messages/${sid}.json`, {
      method: 'DELETE',
      headers: { Authorization: this.auth },
    })
    if (res.ok || res.status === 404) return
    const json = (await res.json().catch(() => ({}))) as { message?: string; code?: number }
    throw new TwilioError(
      `Twilio delete failed: ${json.message ?? res.statusText}`,
      res.status,
      json.code ?? null,
    )
  }
}
