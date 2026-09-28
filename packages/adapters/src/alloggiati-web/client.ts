import { all, envelope, outcome, soapAction, text, type Operation, type Outcome } from './protocol'

/**
 * The smallest Alloggiati Web client the adapter needs (WP1.2): a token, a
 * validation pass, a send, and the day's receipt. Plain `fetch`.
 *
 * It knows nothing about properties, obligations or retries. It reports what
 * happened in three kinds the adapter maps onto the port's errors:
 *
 *   - `unavailable`: no answer, a timeout, or a 5xx. Worth trying again.
 *   - `unauthorized`: the credentials were refused. Not worth trying again
 *     until somebody fixes them.
 *   - `protocol`: an answer we could not read. Not worth trying again either:
 *     the same request will be misread the same way.
 *   - `ambiguous`: a `Send` that timed out. The request left, so the service
 *     may have filed it; sending again could declare the same guests twice.
 */
export type ClientErrorKind = 'unavailable' | 'unauthorized' | 'protocol' | 'ambiguous'

export class AlloggiatiWebError extends Error {
  constructor(
    readonly kind: ClientErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'AlloggiatiWebError'
  }
}

export interface Credentials {
  /** The structure's Alloggiati Web user. */
  username: string
  password: string
  /** The web-service key generated in the portal for this user. */
  wsKey: string
}

export interface LinesResult {
  /** How many lines the service accepted. */
  valid: number
  /** One outcome per line, in the order sent. */
  lines: Outcome[]
  /** The operation's own outcome. */
  result: Outcome
}

export interface AlloggiatiWebClientOptions {
  endpoint: string
  fetch?: typeof fetch
  /** Per request. The service is slow at night; a hung call must still end. */
  timeoutMs?: number
}

/** Token errors the service reports inside a 200, which mean "credentials". */
const AUTH_CODES = new Set(['AUTH', 'TOKEN', 'UTENTE', 'WSKEY', 'PASSWORD'])

export class AlloggiatiWebClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: AlloggiatiWebClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 20_000
  }

  async generateToken(credentials: Credentials): Promise<{ token: string; expires: Date }> {
    const xml = await this.call('GenerateToken', {
      Utente: credentials.username,
      Password: credentials.password,
      WsKey: credentials.wsKey,
    })
    const result = firstOutcome(xml)
    const token = text(xml, 'token')
    if (!result.ok || !token) {
      throw new AlloggiatiWebError(
        'unauthorized',
        `credentials refused: ${result.description || result.code || 'no token'}`,
      )
    }
    const expires = new Date(text(xml, 'expires') ?? '')
    return {
      token,
      expires: Number.isNaN(expires.getTime()) ? new Date(Date.now() + 30 * 60_000) : expires,
    }
  }

  /** Validates lines without filing them. */
  test(username: string, token: string, lines: string[]): Promise<LinesResult> {
    return this.lines('Test', username, token, lines)
  }

  /** Files lines. */
  send(username: string, token: string, lines: string[]): Promise<LinesResult> {
    return this.lines('Send', username, token, lines)
  }

  /** Whether the service holds a receipt for this day (`YYYY-MM-DD`). */
  async receipt(username: string, token: string, date: string): Promise<{ available: boolean }> {
    const xml = await this.call('Ricevuta', { Utente: username, token, Data: date })
    const result = firstOutcome(xml)
    this.raiseIfAuth(result)
    return { available: result.ok && Boolean(text(xml, 'PDF')) }
  }

  private async lines(
    operation: 'Test' | 'Send',
    username: string,
    token: string,
    lines: string[],
  ): Promise<LinesResult> {
    const xml = await this.call(operation, { Utente: username, token, ElencoSchedine: lines })
    const result = firstOutcome(xml)
    this.raiseIfAuth(result)
    const details = all(xml, 'EsitoOperazioneServizio').map(outcome)
    if (details.length !== lines.length) {
      throw new AlloggiatiWebError(
        'protocol',
        `${operation}: ${details.length} outcomes for ${lines.length} lines`,
      )
    }
    return { valid: Number(text(xml, 'SchedineValide') ?? 0), lines: details, result }
  }

  private raiseIfAuth(result: Outcome): void {
    if (!result.ok && AUTH_CODES.has(result.code.toUpperCase())) {
      throw new AlloggiatiWebError('unauthorized', `credentials refused: ${result.description}`)
    }
  }

  private async call(operation: Operation, fields: Record<string, string | string[]>) {
    let response: Response
    try {
      response = await this.fetchImpl(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'text/xml; charset=utf-8',
          soapaction: `"${soapAction(operation)}"`,
        },
        body: envelope(operation, fields),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError'
      throw new AlloggiatiWebError(
        timedOut && operation === 'Send' ? 'ambiguous' : 'unavailable',
        `${operation}: no answer (${cause instanceof Error ? cause.name : 'error'})`,
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new AlloggiatiWebError('unauthorized', `${operation}: HTTP ${response.status}`)
    }
    if (response.status >= 500 || response.status === 429) {
      throw new AlloggiatiWebError('unavailable', `${operation}: HTTP ${response.status}`)
    }
    const xml = await response.text()
    if (!response.ok || text(xml, 'faultstring') !== null) {
      throw new AlloggiatiWebError(
        'protocol',
        `${operation}: ${text(xml, 'faultstring') ?? `HTTP ${response.status}`}`,
      )
    }
    return xml
  }
}

/** The operation's own outcome: the first `result` element. */
function firstOutcome(xml: string): Outcome {
  const [result] = all(xml, 'result')
  return outcome(result ?? '')
}
