import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Twilio's webhook signature (ADR-032, ADR-035): HMAC-SHA1, keyed with the
 * auth token, over the full public URL followed by every POST parameter as
 * `name + value`, sorted by name; base64-encoded in `X-Twilio-Signature`.
 *
 * The URL is the one Twilio called — scheme, host, path and query exactly —
 * which behind a proxy is not the one the process sees. The caller passes the
 * configured public base plus the path, never `request.url`.
 */
export function twilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(payload, 'utf8').digest('base64')
}

export function verifyTwilioSignature(input: {
  url: string
  params: Record<string, string>
  signature: string | null | undefined
  authToken: string
}): boolean {
  if (!input.signature) return false
  const expected = Buffer.from(twilioSignature(input.url, input.params, input.authToken))
  const given = Buffer.from(input.signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
