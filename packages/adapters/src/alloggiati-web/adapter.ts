import { createHash } from 'node:crypto'
import {
  AlloggiatiError,
  RECORD_WIDTH,
  type AcknowledgementResult,
  type AlloggiatiAdapter,
  type CodeResolver,
  type SubmitInput,
  type SubmitResult,
} from '@bookone/core/alloggiati'
import { AlloggiatiWebClient, AlloggiatiWebError, type Credentials } from './client'

/**
 * Alloggiati Web as an `AlloggiatiAdapter` (WP1.2).
 *
 * ## Only the simulator, for now
 *
 * The constructor refuses any environment but `simulator`, and any endpoint
 * that is not on this machine. A real submission needs three things this code
 * does not have and must not improvise: the software-house registration, a
 * pilot's credentials held in Secret Manager (never in an env file), and the
 * owner's go-ahead for a production filing (WP1.2 "stop and ask"). Lifting the
 * guard is a change reviewed on its own, not a configuration value.
 *
 * ## What a filing is
 *
 * Every line is validated by the service first (`Test`), then filed (`Send`).
 * The service files a batch only when every line is valid, so a family is
 * filed whole or not at all. The answer is immediate: a filing is either
 * acknowledged on return or it failed, and the receipt is what we keep. It
 * holds the reference, the counts and a checksum, never a name (ADR-039).
 *
 * ## Failures
 *
 * | What happened | Port error | Retried |
 * |---|---|---|
 * | No answer, a 5xx | `unavailable` | yes |
 * | Credentials refused, or none recorded | `unauthorized` | no: fix the credentials |
 * | A line refused | `rejected`, naming the guest and the field | no: fix the data |
 * | A send that timed out | `unavailable` | **no**: it may have been filed |
 * | An answer we cannot read | `rejected` | no |
 */
export type AlloggiatiEnvironment = 'simulator'

/** Where a property's Alloggiati Web credentials come from. */
export interface CredentialSource {
  forProperty(propertyId: string): Promise<Credentials | null>
}

/** One set of test credentials for every property: the simulator's. */
export class SimulatorCredentialSource implements CredentialSource {
  constructor(private readonly credentials: Credentials) {}
  async forProperty(): Promise<Credentials> {
    return this.credentials
  }
}

export interface AlloggiatiWebAdapterOptions {
  endpoint: string
  environment: AlloggiatiEnvironment
  credentials: CredentialSource
  codes: CodeResolver
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => Date
}

export class AlloggiatiWebAdapter implements AlloggiatiAdapter {
  readonly channel = 'alloggiati-web'
  readonly simulated: boolean
  readonly codes: CodeResolver

  private readonly client: AlloggiatiWebClient
  private readonly now: () => Date
  private readonly tokens = new Map<string, { token: string; expires: Date; username: string }>()
  private readonly filings = new Map<
    string,
    { propertyId: string; receipt: Record<string, unknown> }
  >()

  constructor(private readonly options: AlloggiatiWebAdapterOptions) {
    if (options.environment !== 'simulator') {
      throw new Error('Alloggiati Web: only the simulator environment is supported (WP1.2)')
    }
    const host = new URL(options.endpoint).hostname
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
      throw new Error(`Alloggiati Web: the simulator must be local, not ${host}`)
    }
    this.simulated = true
    this.codes = options.codes
    this.now = options.now ?? (() => new Date())
    this.client = new AlloggiatiWebClient({
      endpoint: options.endpoint,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    })
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const lines = input.payload.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length === 0) throw new AlloggiatiError('rejected', 'the file is empty', false)
    if (lines.length !== input.guestCount) {
      throw new AlloggiatiError(
        'rejected',
        `the file has ${lines.length} lines for ${input.guestCount} guests`,
        false,
      )
    }
    const wrong = lines.findIndex((line) => line.length !== RECORD_WIDTH)
    if (wrong >= 0) {
      throw new AlloggiatiError(
        'rejected',
        `line ${wrong + 1} is ${lines[wrong]!.length} characters, not ${RECORD_WIDTH}`,
        false,
      )
    }

    const checked = await this.withToken(input.propertyId, (username, token) =>
      this.client.test(username, token, lines),
    )
    refuseInvalid(checked.lines)

    const sent = await this.withToken(input.propertyId, (username, token) =>
      this.client.send(username, token, lines),
    )
    refuseInvalid(sent.lines)

    const checksum = createHash('sha256').update(input.payload).digest('hex')
    const filedAt = this.now()
    const reference = `AW-${filedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${createHash(
      'sha256',
    )
      .update(`${input.propertyId}|${input.reservationId}|${checksum}`)
      .digest('hex')
      .slice(0, 12)}`
    // No guest in here: the receipt outlives the payload (ADR-039).
    const receipt = {
      reference,
      channel: this.channel,
      environment: this.options.environment,
      filedAt: filedAt.toISOString(),
      lines: sent.valid,
      payloadChecksum: checksum,
      simulated: this.simulated,
    }
    this.filings.set(reference, { propertyId: input.propertyId, receipt })
    return { reference, receipt }
  }

  async checkAcknowledgement(input: {
    propertyId: string
    reference: string
  }): Promise<AcknowledgementResult> {
    const filing = this.filings.get(input.reference)
    if (!filing || filing.propertyId !== input.propertyId) {
      return { status: 'failed', reason: 'unknown reference' }
    }
    return { status: 'acknowledged', receipt: filing.receipt }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string; checkedAt: Date }> {
    const checkedAt = this.now()
    try {
      await this.client.generateToken({ username: '', password: '', wsKey: '' })
      return { healthy: true, checkedAt }
    } catch (error) {
      // Refused credentials still mean the service answered.
      if (error instanceof AlloggiatiWebError && error.kind === 'unauthorized') {
        return { healthy: true, checkedAt }
      }
      return { healthy: false, message: (error as Error).message, checkedAt }
    }
  }

  async dailyReceipt(input: { propertyId: string; day: string }): Promise<{ available: boolean }> {
    return this.withToken(input.propertyId, (username, token) =>
      this.client.receipt(username, token, input.day),
    )
  }

  /**
   * Runs a call with the property's token, fetching one when there is none or
   * it is about to expire, and once more if the service says it expired.
   */
  private async withToken<T>(
    propertyId: string,
    call: (username: string, token: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.token(propertyId, attempt > 0)
      try {
        return await call(session.username, session.token)
      } catch (error) {
        if (error instanceof AlloggiatiWebError && error.kind === 'unauthorized' && attempt === 0) {
          this.tokens.delete(propertyId)
          continue
        }
        throw toPortError(error)
      }
    }
    throw new AlloggiatiError('unauthorized', 'the service refused a fresh token', false)
  }

  private async token(propertyId: string, fresh: boolean) {
    const cached = this.tokens.get(propertyId)
    if (!fresh && cached && cached.expires.getTime() - this.now().getTime() > 60_000) return cached

    const credentials = await this.options.credentials.forProperty(propertyId)
    if (!credentials) {
      throw new AlloggiatiError(
        'unauthorized',
        'no Alloggiati Web credentials are recorded for this property',
        false,
      )
    }
    try {
      const issued = await this.client.generateToken(credentials)
      const session = { ...issued, username: credentials.username }
      this.tokens.set(propertyId, session)
      return session
    } catch (error) {
      throw toPortError(error)
    }
  }
}

/** A refused line, in words the desk can act on: which guest, which field, what the service said. */
function refuseInvalid(lines: { ok: boolean; description: string; detail: string }[]): void {
  const refused = lines
    .map((line, index) => ({ ...line, index }))
    .filter((line) => !line.ok)
    .map(
      (line) =>
        `Guest ${line.index + 1}: ${line.description}${line.detail ? ` (${line.detail})` : ''}`,
    )
  if (refused.length > 0) {
    throw new AlloggiatiError(
      'rejected',
      `the registry refused the filing — ${refused.join('; ')}`,
      false,
    )
  }
}

function toPortError(error: unknown): AlloggiatiError {
  if (error instanceof AlloggiatiError) return error
  if (error instanceof AlloggiatiWebError) {
    switch (error.kind) {
      case 'unavailable':
        return new AlloggiatiError('unavailable', error.message, true)
      case 'unauthorized':
        return new AlloggiatiError('unauthorized', error.message, false)
      case 'ambiguous':
        return new AlloggiatiError(
          'unavailable',
          'no answer after sending: the filing may have gone through. Check the day’s receipt on the portal before filing by hand.',
          false,
        )
      case 'protocol':
        return new AlloggiatiError('rejected', `unreadable answer: ${error.message}`, false)
    }
  }
  return new AlloggiatiError('unavailable', String(error), true)
}
