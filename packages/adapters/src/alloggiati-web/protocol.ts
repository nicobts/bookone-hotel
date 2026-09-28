/**
 * The Alloggiati Web service's messages (WP1.2), as the client writes them and
 * the simulator reads them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFY BEFORE PRODUCTION: operation names, element names and the namespace
 *  are written from the service's public documentation, not captured from the
 *  test environment. The client and the simulator share this file, so they
 *  agree with each other by construction; whether they agree with the
 *  authority is the first thing the test environment answers
 *  (docs/runbooks/alloggiati.md, go-live check 4).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SOAP 1.1 over HTTPS. The operations used:
 *
 *   GenerateToken(Utente, Password, WsKey)       → a token with an expiry
 *   Test(Utente, token, ElencoSchedine)          → per-line validation, nothing filed
 *   Send(Utente, token, ElencoSchedine)          → per-line outcome, filed
 *   Ricevuta(Utente, token, Data)                → the day's receipt, if any
 *
 * Built and read with string templates and a narrow reader rather than a SOAP
 * or XML library: four fixed messages do not justify a dependency (the same
 * call as the Twilio client).
 */

export const NAMESPACE = 'AlloggiatiService'

export type Operation = 'GenerateToken' | 'Test' | 'Send' | 'Ricevuta'

/** One line's outcome, or the operation's. */
export interface Outcome {
  ok: boolean
  /** The service's error code, when not ok. */
  code: string
  /** The service's description. */
  description: string
  /** The detail, e.g. which field. */
  detail: string
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function envelope(operation: Operation, fields: Record<string, string | string[]>): string {
  const body = Object.entries(fields)
    .map(([name, value]) =>
      Array.isArray(value)
        ? `<${name}>${value.map((line) => `<string>${escapeXml(line)}</string>`).join('')}</${name}>`
        : `<${name}>${escapeXml(value)}</${name}>`,
    )
    .join('')
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${operation} xmlns="${NAMESPACE}">${body}</${operation}></soap:Body>` +
    '</soap:Envelope>'
  )
}

export function soapAction(operation: Operation): string {
  return `${NAMESPACE}/${operation}`
}

/** The text of the first element with this local name, or null. */
export function text(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(
    xml,
  )
  return match ? unescapeXml(match[1]!.trim()) : null
}

/** Every element with this local name, as raw inner XML. */
export function all(xml: string, name: string): string[] {
  const pattern = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
    'g',
  )
  return [...xml.matchAll(pattern)].map((match) => match[1]!)
}

export function outcome(xml: string): Outcome {
  return {
    ok: text(xml, 'esito') === 'true',
    code: text(xml, 'ErroreCod') ?? '',
    description: text(xml, 'ErroreDes') ?? '',
    detail: text(xml, 'ErroreDettaglio') ?? '',
  }
}

export function outcomeXml(result: Outcome): string {
  return (
    `<esito>${result.ok}</esito>` +
    `<ErroreCod>${escapeXml(result.code)}</ErroreCod>` +
    `<ErroreDes>${escapeXml(result.description)}</ErroreDes>` +
    `<ErroreDettaglio>${escapeXml(result.detail)}</ErroreDettaglio>`
  )
}

export function responseEnvelope(operation: Operation, inner: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${operation}Response xmlns="${NAMESPACE}">${inner}</${operation}Response></soap:Body>` +
    '</soap:Envelope>'
  )
}
