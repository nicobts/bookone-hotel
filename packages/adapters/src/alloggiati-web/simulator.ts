import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FIELDS, RECORD_WIDTH, guestTypes, type CodeTables } from '@bookone/core/alloggiati'
import { all, outcomeXml, responseEnvelope, text, type Operation, type Outcome } from './protocol'
import type { Credentials } from './client'

/**
 * A local stand-in for the Alloggiati Web service (WP1.2). Files nothing, talks
 * to nobody: an HTTP server on the loopback interface that answers the four
 * operations the way the service is documented to, checking every line against
 * the code tables it was given.
 *
 * It exists so the adapter can be built and tested before anybody holds real
 * credentials, and so the outage drill (retries, then a person, then evidence)
 * can be run on demand: `outage(n)` makes the next n calls fail with 503,
 * `refuseCredentials()` makes every token request fail.
 *
 * The line checks are ours, written from public documentation. They are a
 * reasonable proxy for the authority's and not a substitute: the test
 * environment is (docs/runbooks/alloggiati.md).
 */
export interface SimulatorOptions {
  tables: CodeTables
  credentials: Credentials
  /** 0 picks a free port. */
  port?: number
  now?: () => Date
}

export interface AlloggiatiSimulator {
  url: string
  /** The next `times` calls answer 503. */
  outage(times: number): void
  /** Token requests are refused until `acceptCredentials()`. */
  refuseCredentials(): void
  acceptCredentials(): void
  /** Lines filed, per user and day (`YYYY-MM-DD`). */
  filed(username: string, day: string): string[]
  close(): Promise<void>
}

const HEAD_TYPES = new Set<string>([guestTypes.single, guestTypes.familyHead, guestTypes.groupHead])

export async function startAlloggiatiSimulator(
  options: SimulatorOptions,
): Promise<AlloggiatiSimulator> {
  const now = options.now ?? (() => new Date())
  const tokens = new Map<string, { username: string; expires: Date }>()
  const filed = new Map<string, string[]>()
  let outages = 0
  let refusing = false

  const states = new Set(options.tables.places.filter((p) => p.kind === 'stato').map((p) => p.code))
  const comuni = new Set(
    options.tables.places.filter((p) => p.kind === 'comune').map((p) => p.code),
  )
  const documents = new Set(options.tables.documents.map((d) => d.code))
  const italy = options.tables.places.find((p) => p.kind === 'stato' && p.name === 'ITALIA')?.code

  const ok: Outcome = { ok: true, code: '', description: '', detail: '' }
  const fail = (code: string, description: string, detail = ''): Outcome => ({
    ok: false,
    code,
    description,
    detail,
  })

  function check(line: string): Outcome {
    if (line.length !== RECORD_WIDTH) {
      return fail('TRACCIATO', `Lunghezza record errata: ${line.length}`, `attesi ${RECORD_WIDTH}`)
    }
    const fields: Record<string, string> = {}
    let offset = 0
    for (const field of FIELDS) {
      fields[field.name] = line.slice(offset, offset + field.width).trim()
      offset += field.width
    }
    if (!/^(16|17|18|19|20)$/.test(fields.guestType!)) {
      return fail('TIPO', 'Tipo alloggiato non valido', fields.guestType!)
    }
    for (const date of ['arrivalDate', 'birthDate']) {
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fields[date]!)) return fail('DATA', 'Data non valida', date)
    }
    if (!states.has(fields.birthCountryCode!)) {
      return fail('STATO', 'Stato di nascita non valido', fields.birthCountryCode!)
    }
    if (!states.has(fields.citizenshipCode!)) {
      return fail('CITTADINANZA', 'Cittadinanza non valida', fields.citizenshipCode!)
    }
    if (fields.birthCountryCode === italy && !comuni.has(fields.birthPlaceCode!)) {
      return fail('COMUNE', 'Comune di nascita non valido', fields.birthPlaceCode!)
    }
    if (HEAD_TYPES.has(fields.guestType!)) {
      if (!documents.has(fields.documentType!)) {
        return fail('DOCUMENTO', 'Tipo documento non valido', fields.documentType!)
      }
      if (!fields.documentNumber) return fail('DOCUMENTO', 'Numero documento mancante')
      const issuer = fields.documentIssuerCode!
      if (!states.has(issuer) && !comuni.has(issuer)) {
        return fail('RILASCIO', 'Luogo di rilascio non valido', issuer)
      }
    }
    return ok
  }

  function answer(operation: Operation, body: string): string {
    const result = (outcome: Outcome) => `<result>${outcomeXml(outcome)}</result>`

    if (operation === 'GenerateToken') {
      const matches =
        !refusing &&
        text(body, 'Utente') === options.credentials.username &&
        text(body, 'Password') === options.credentials.password &&
        text(body, 'WsKey') === options.credentials.wsKey
      if (!matches) return result(fail('AUTH', 'Credenziali non valide'))
      const token = `SIM-${Math.random().toString(36).slice(2)}`
      const expires = new Date(now().getTime() + 30 * 60_000)
      tokens.set(token, { username: options.credentials.username, expires })
      return (
        result(ok) +
        `<GenerateTokenResult><issued>${now().toISOString()}</issued>` +
        `<expires>${expires.toISOString()}</expires><token>${token}</token></GenerateTokenResult>`
      )
    }

    const username = text(body, 'Utente') ?? ''
    const session = tokens.get(text(body, 'token') ?? '')
    if (!session || session.username !== username || session.expires <= now()) {
      return result(fail('TOKEN', 'Token non valido o scaduto'))
    }

    if (operation === 'Ricevuta') {
      const day = text(body, 'Data') ?? ''
      const has = (filed.get(`${username}|${day}`) ?? []).length > 0
      return has
        ? result(ok) + `<PDF>${Buffer.from('SIMULATED RECEIPT').toString('base64')}</PDF>`
        : result(fail('RICEVUTA', 'Nessuna ricevuta per la data'))
    }

    const lines = all(body, 'string').map((line) =>
      line
        .replace(/&amp;/g, '&')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"'),
    )
    const outcomes = lines.map(check)
    const valid = outcomes.filter((o) => o.ok).length
    // The service files a batch only when every line is valid: a family is
    // one declaration, and half of one is not a filing.
    if (operation === 'Send' && valid === lines.length && lines.length > 0) {
      const key = `${username}|${now().toISOString().slice(0, 10)}`
      filed.set(key, [...(filed.get(key) ?? []), ...lines])
    }
    return (
      result(valid === lines.length ? ok : fail('SCHEDINE', 'Schedine non valide')) +
      `<SchedineValide>${valid}</SchedineValide>` +
      `<Dettaglio>${outcomes
        .map((o) => `<EsitoOperazioneServizio>${outcomeXml(o)}</EsitoOperazioneServizio>`)
        .join('')}</Dettaglio>`
    )
  }

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (outages > 0) {
        outages -= 1
        response.writeHead(503).end('Service Unavailable')
        return
      }
      const body = Buffer.concat(chunks).toString('utf8')
      const operation = /<(GenerateToken|Test|Send|Ricevuta)\s/.exec(body)?.[1] as
        Operation | undefined
      if (!operation) {
        response
          .writeHead(500, { 'content-type': 'text/xml' })
          .end('<soap:Fault><faultstring>Unknown operation</faultstring></soap:Fault>')
        return
      }
      response
        .writeHead(200, { 'content-type': 'text/xml; charset=utf-8' })
        .end(responseEnvelope(operation, answer(operation, body)))
    })
  })

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/service/service.asmx`,
    outage: (times) => {
      outages = times
    },
    refuseCredentials: () => {
      refusing = true
    },
    acceptCredentials: () => {
      refusing = false
    },
    filed: (username, day) => [...(filed.get(`${username}|${day}`) ?? [])],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
