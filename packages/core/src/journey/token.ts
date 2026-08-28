import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The stay token behind `/stay/[token]` (ADR-007).
 *
 * A guest never holds a database session. This token is the whole of their
 * authorisation, so it is worth being precise about what it is and is not.
 *
 * **It is:** a signed statement that the bearer may act on one reservation,
 * until a stated instant. Signed with a secret only the server holds, so a
 * guest cannot mint one for somebody else's stay, and cannot extend their own
 * by editing the expiry — the signature covers it.
 *
 * **It is not:** a session, a capability list, or proof of identity. It says
 * *which* reservation, not *what may be done to it*; the surface decides that,
 * and the journey machine refuses anything illegal regardless.
 *
 * ## Stateless, and the honest cost of that
 *
 * No table. The token carries its own expiry and is verified arithmetically,
 * which means it works from an email opened three days later without a lookup,
 * and cannot be left dangling by a row nobody cleaned up.
 *
 * The cost is that an individual token cannot be revoked before it expires.
 * That is acceptable here and would not be everywhere: the token grants access
 * to one guest's own booking, the resolver re-reads the reservation on every
 * request (so a cancelled stay stops working immediately), and rotating the
 * secret invalidates every token at once if one is ever leaked in bulk. If a
 * future surface needs per-token revocation, it needs a table, and that is a
 * different decision written down at the time.
 *
 * ## Lifetime
 *
 * Not "short-lived" in the fifteen-minute sense, because the job it does is not
 * short: the invitation goes out at T-48h and the guest may finish the form on
 * the morning they arrive. It expires a day after departure, which is the point
 * at which there is nothing left to do.
 */

const VERSION = 'v1'

/** A day past departure. See the lifetime note above. */
export const TOKEN_GRACE_DAYS = 1

export interface StayTokenPayload {
  reservationId: string
  /** Unix seconds. Covered by the signature. */
  expiresAt: number
}

export type TokenFailure =
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  /** No secret configured. A refusal, never a fallback to unsigned. */
  | 'not-configured'

export type VerifyResult =
  { ok: true; payload: StayTokenPayload } | { ok: false; reason: TokenFailure }

function secret(): string | null {
  const value = process.env.STAY_TOKEN_SECRET ?? ''

  // Length-checked, and no default. A default would be a published secret, and
  // a short one is a secret that can be searched for — this signs the only
  // credential a guest has.
  return value.length >= 32 ? value : null
}

export function signStayToken(
  reservationId: string,
  departureDate: string,
  now: Date = new Date(),
): string | null {
  const key = secret()
  if (!key) return null

  const departure = Date.parse(`${departureDate}T00:00:00Z`)
  const base = Number.isNaN(departure) ? now.getTime() : departure

  const expiresAt = Math.floor((base + TOKEN_GRACE_DAYS * 86_400_000) / 1000)
  const body = `${VERSION}.${reservationId}.${expiresAt}`

  return `${body}.${sign(body, key)}`
}

export function verifyStayToken(token: string, now: Date = new Date()): VerifyResult {
  const key = secret()
  if (!key) return { ok: false, reason: 'not-configured' }

  const parts = token.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'malformed' }

  const [version, reservationId, expiresRaw, signature] = parts as [string, string, string, string]
  if (version !== VERSION) return { ok: false, reason: 'malformed' }

  const expiresAt = Number(expiresRaw)
  if (!Number.isInteger(expiresAt)) return { ok: false, reason: 'malformed' }

  // Signature first, expiry second. Checking expiry on an unverified payload
  // would answer questions about a string nobody vouched for, and the ordering
  // costs nothing.
  const body = `${version}.${reservationId}.${expiresRaw}`
  if (!verify(body, signature, key)) return { ok: false, reason: 'bad-signature' }

  if (expiresAt * 1000 < now.getTime()) return { ok: false, reason: 'expired' }

  return { ok: true, payload: { reservationId, expiresAt } }
}

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url')
}

function verify(body: string, signature: string, key: string): boolean {
  const expected = Buffer.from(sign(body, key), 'utf8')
  const presented = Buffer.from(signature, 'utf8')

  // Length-checked first: `timingSafeEqual` throws on a mismatch, and the throw
  // is itself a length oracle.
  if (expected.length !== presented.length) return false

  return timingSafeEqual(expected, presented)
}
