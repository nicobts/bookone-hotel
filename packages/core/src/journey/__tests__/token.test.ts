import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signStayToken, verifyStayToken } from '../token'

/**
 * The stay token is the whole of a guest's authorisation (ADR-007).
 *
 * There is no session behind it and no second factor. So these tests are less
 * about the happy path than about every way somebody might try to make one say
 * something it does not.
 */

const SECRET = 'a-test-secret-that-is-long-enough-to-be-accepted'
const RESERVATION = 'aa11bb22-cc33-dd44-ee55-ff6677889900'

let original: string | undefined

beforeEach(() => {
  original = process.env.STAY_TOKEN_SECRET
  process.env.STAY_TOKEN_SECRET = SECRET
})

afterEach(() => {
  if (original === undefined) delete process.env.STAY_TOKEN_SECRET
  else process.env.STAY_TOKEN_SECRET = original
})

describe('signStayToken', () => {
  it('produces a token that verifies', () => {
    const token = signStayToken(RESERVATION, '2026-09-05', new Date('2026-09-01T10:00:00Z'))

    expect(token).toBeTruthy()

    const result = verifyStayToken(token!, new Date('2026-09-02T10:00:00Z'))

    expect(result.ok).toBe(true)
    expect(result.ok && result.payload.reservationId).toBe(RESERVATION)
  })

  it('stays valid through the stay and a day past departure', () => {
    const token = signStayToken(RESERVATION, '2026-09-05', new Date('2026-09-01T10:00:00Z'))!

    // The guest finishes the form on the morning they arrive, or asks a
    // question on the day they leave. A fifteen-minute token would be useless
    // for the job this one has.
    expect(verifyStayToken(token, new Date('2026-09-05T12:00:00Z')).ok).toBe(true)
    expect(verifyStayToken(token, new Date('2026-09-05T23:00:00Z')).ok).toBe(true)
  })

  it('expires after the grace day', () => {
    const token = signStayToken(RESERVATION, '2026-09-05', new Date('2026-09-01T10:00:00Z'))!

    const result = verifyStayToken(token, new Date('2026-09-07T00:01:00Z'))

    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuses to sign without a configured secret', () => {
    delete process.env.STAY_TOKEN_SECRET

    // Not a fallback to unsigned, and not a default secret — a default would be
    // a published one, and this signs the only credential a guest holds.
    expect(signStayToken(RESERVATION, '2026-09-05')).toBeNull()
  })

  it('refuses a secret short enough to search for', () => {
    process.env.STAY_TOKEN_SECRET = 'short'

    expect(signStayToken(RESERVATION, '2026-09-05')).toBeNull()
  })
})

describe('verifyStayToken', () => {
  const token = () => signStayToken(RESERVATION, '2026-09-05', new Date('2026-09-01T10:00:00Z'))!

  it('rejects a token whose expiry was edited', () => {
    const [version, reservation, expires, signature] = token().split('.')
    const extended = `${version}.${reservation}.${Number(expires) + 86_400 * 365}.${signature}`

    // The signature covers the expiry. Without that, extending a token would be
    // a text edit anyone could make in the address bar.
    expect(verifyStayToken(extended, new Date('2026-09-02T10:00:00Z'))).toEqual({
      ok: false,
      reason: 'bad-signature',
    })
  })

  it('rejects a token pointed at somebody else’s reservation', () => {
    const [version, , expires, signature] = token().split('.')
    const swapped = `${version}.11111111-2222-3333-4444-555555555555.${expires}.${signature}`

    expect(verifyStayToken(swapped, new Date('2026-09-02T10:00:00Z'))).toEqual({
      ok: false,
      reason: 'bad-signature',
    })
  })

  it('rejects a token signed with a different secret', () => {
    const foreign = token()
    process.env.STAY_TOKEN_SECRET = 'a-completely-different-secret-of-sufficient-length'

    // This is what secret rotation does: every outstanding token stops working
    // at once, which is the blunt instrument if one is ever leaked in bulk.
    expect(verifyStayToken(foreign, new Date('2026-09-02T10:00:00Z'))).toEqual({
      ok: false,
      reason: 'bad-signature',
    })
  })

  it.each([
    ['empty', ''],
    ['not a token', 'hello'],
    ['too few parts', 'v1.abc.123'],
    ['too many parts', 'v1.abc.123.sig.extra'],
    ['a future version', 'v2.abc.123.sig'],
    ['a non-numeric expiry', 'v1.abc.soon.sig'],
  ])('rejects %s as malformed', (_label, value) => {
    const result = verifyStayToken(value, new Date('2026-09-02T10:00:00Z'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
  })

  it('refuses everything when no secret is configured', () => {
    const valid = token()
    delete process.env.STAY_TOKEN_SECRET

    // A refusal, never a pass-through. An unconfigured environment must not be
    // an environment where every token works.
    expect(verifyStayToken(valid, new Date('2026-09-02T10:00:00Z'))).toEqual({
      ok: false,
      reason: 'not-configured',
    })
  })

  it('checks the signature before the expiry', () => {
    // An expired token with a bad signature reports the signature. Answering
    // questions about a string nobody vouched for is how a verifier turns into
    // an oracle, and the ordering costs nothing.
    const [version, reservation, , signature] = token().split('.')
    const forged = `${version}.${reservation}.1.${signature}`

    expect(verifyStayToken(forged, new Date('2026-09-02T10:00:00Z'))).toEqual({
      ok: false,
      reason: 'bad-signature',
    })
  })
})
