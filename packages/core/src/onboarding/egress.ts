import { lookup } from 'node:dns/promises'

/**
 * The guard on every outbound fetch to a URL somebody typed.
 *
 * ## Why this exists
 *
 * AG-03 fetches a property's own website, from a URL the owner supplies, from
 * inside our worker — and then **stores the response and shows it back to
 * them** as knowledge-base drafts. That is not blind SSRF. It is a read
 * primitive against everything our worker can reach, with the output rendered
 * in the requester's own console.
 *
 * Concretely, without this guard an owner could point AG-03 at
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` and read
 * the reply in their knowledge editor. Or at the Supabase REST endpoint on the
 * same host. Or at any internal service that answers on a private address.
 *
 * "Only authenticated owners can set the URL" is not a defence. An owner is
 * trusted with their property's data and with nothing whatsoever about our
 * infrastructure, and those are different grants.
 *
 * ## What it does
 *
 * Resolves the hostname and refuses if **any** address it resolves to is
 * loopback, link-local, private, unique-local, multicast or reserved. Any,
 * not the first: a name with one public and one private A record would
 * otherwise be a bypass depending on resolver ordering.
 *
 * ## The residual risk, stated
 *
 * This is check-then-connect, so DNS rebinding remains possible in principle: a
 * name that resolves public here and private a moment later when `fetch` does
 * its own lookup. Closing it properly means pinning the connection to the
 * address we validated, which Node's `fetch` does not expose, or enforcing the
 * allowlist at the network layer with an egress proxy. **The egress proxy is
 * the real answer and belongs in the Sprint 10 hardening work**; this closes
 * the direct attack and narrows the remaining one to a race.
 */

export type EgressRefusal =
  'unparseable' | 'scheme' | 'metadata-host' | 'private-address' | 'unresolvable'

export type EgressCheck = { ok: true; url: URL } | { ok: false; reason: EgressRefusal }

/**
 * Hostnames that reach a metadata service without ever looking private.
 *
 * `metadata.google.internal` resolves to 169.254.169.254 and would be caught by
 * the address check anyway — but only if DNS answers, and a resolver inside a
 * cloud network is exactly the one that answers. Naming them is a second line
 * that costs nothing.
 */
const BLOCKED_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'localhost',
])

/** Parse an IPv4 dotted quad into a 32-bit number, or null. */
function ipv4ToInt(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }

  return value
}

/** CIDR blocks that must never be reachable from a user-supplied URL. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — cloud metadata lives here
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255 with it
]

export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address)
  if (value === null) return true // unparseable is not something to connect to

  return BLOCKED_V4.some(([base, bits]) => {
    const baseValue = ipv4ToInt(base)!
    // `>>> 0` because a 32-bit mask with bits = 0 would shift into the sign.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0

    return (value & mask) >>> 0 === (baseValue & mask) >>> 0
  })
}

/**
 * Expand an IPv6 address to its eight hextets.
 *
 * A small parser rather than a dependency: the input comes from the resolver
 * and is already well formed, and what we need from it is the first byte or
 * two. Returns null on anything unexpected, which the caller treats as blocked.
 */
function expandIpv6(address: string): number[] | null {
  const [head, tail, ...rest] = address.toLowerCase().split('::')
  if (rest.length > 0) return null

  const parse = (part: string | undefined): number[] =>
    part && part.length > 0 ? part.split(':').map((hextet) => Number.parseInt(hextet, 16)) : []

  const left = parse(head)
  const right = parse(tail)

  if ([...left, ...right].some((hextet) => Number.isNaN(hextet))) return null

  const hextets =
    tail === undefined
      ? left
      : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]

  return hextets.length === 8 ? hextets : null
}

export function isBlockedIpv6(address: string): boolean {
  // Zone index, as in `fe80::1%eth0`. Never a public address either way.
  const [bare] = address.split('%')
  const hextets = expandIpv6(bare!)
  if (!hextets) return true

  /*
   * IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible addresses.
   *
   * Unwrapped and checked as IPv4, because `::ffff:127.0.0.1` is loopback and
   * a check that only looked at the IPv6 prefix would wave it through.
   */
  if (hextets.slice(0, 5).every((h) => h === 0) && (hextets[5] === 0xffff || hextets[5] === 0)) {
    const low = ((hextets[6]! << 16) | hextets[7]!) >>> 0
    const dotted = [24, 16, 8, 0].map((shift) => (low >>> shift) & 0xff).join('.')

    // `::` and `::1` land here too, and are blocked as 0.0.0.0 and 127.0.0.1.
    return isBlockedIpv4(dotted)
  }

  const first = hextets[0]!

  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast

  return false
}

export function isBlockedAddress(address: string): boolean {
  return address.includes(':') ? isBlockedIpv6(address) : isBlockedIpv4(address)
}

/**
 * Decide whether one URL may be fetched.
 *
 * `resolve` is injectable so the guard can be tested against a hostname that
 * answers however the test needs, without a network and without relying on
 * whatever `example.com` happens to resolve to on a CI runner.
 */
export async function checkEgress(
  raw: string,
  resolve: (host: string) => Promise<{ address: string }[]> = (host) => lookup(host, { all: true }),
): Promise<EgressCheck> {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'unparseable' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // `file:`, `gopher:`, `data:` — none of them are a hotel's website, and
    // each is a different way of reading something we did not mean to read.
    return { ok: false, reason: 'scheme' }
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: 'metadata-host' }

  // A literal address skips DNS entirely; check it directly.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return isBlockedAddress(host) ? { ok: false, reason: 'private-address' } : { ok: true, url }
  }

  let addresses: { address: string }[]

  try {
    addresses = await resolve(host)
  } catch {
    return { ok: false, reason: 'unresolvable' }
  }

  if (addresses.length === 0) return { ok: false, reason: 'unresolvable' }

  /*
   * **Every** address, not the first.
   *
   * A name with one public and one private A record is otherwise a bypass that
   * depends on resolver ordering — which is to say, a bypass that works
   * eventually.
   */
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return { ok: false, reason: 'private-address' }
  }

  return { ok: true, url }
}
