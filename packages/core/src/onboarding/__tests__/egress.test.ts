import { describe, expect, it } from 'vitest'
import { checkEgress, isBlockedAddress, isBlockedIpv4, isBlockedIpv6 } from '../egress'

/**
 * The guard on outbound fetches to user-supplied URLs.
 *
 * AG-03 fetches a URL an owner typed, from inside our worker, and stores the
 * response where they can read it. Without this, that is a read primitive
 * against everything the worker can reach, rendered in the requester's own
 * console.
 *
 * So the cases below are the actual payloads, not abstractions: the AWS and
 * Google metadata endpoints, loopback in its several spellings, and the private
 * ranges. Each is paired with a public address that must still work — a guard
 * that blocks everything is a feature that has been deleted.
 */

/** A resolver that answers however the test needs, so no network is involved. */
const resolving =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address }))

describe('the addresses that must never be reachable', () => {
  it.each([
    ['AWS and OpenStack metadata', '169.254.169.254'],
    ['link-local generally', '169.254.1.1'],
    ['loopback', '127.0.0.1'],
    ['loopback, another spelling', '127.1.2.3'],
    ['this network', '0.0.0.0'],
    ['RFC1918 ten', '10.0.0.1'],
    ['RFC1918 172.16', '172.16.5.4'],
    ['RFC1918 172.31, the far end', '172.31.255.255'],
    ['RFC1918 192.168', '192.168.1.1'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['IETF protocol assignments', '192.0.0.8'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
  ])('blocks %s', (_label, address) => {
    expect(isBlockedIpv4(address)).toBe(true)
  })

  it.each([
    ['a public address', '93.184.216.34'],
    ['just outside RFC1918', '172.32.0.1'],
    ['just outside CGNAT', '100.128.0.1'],
    ['just outside link-local', '169.253.255.255'],
  ])('allows %s', (_label, address) => {
    // The pair to every case above. A guard that blocks everything has removed
    // the feature rather than secured it, and these are the boundaries where an
    // over-broad mask would show up.
    expect(isBlockedIpv4(address)).toBe(false)
  })

  it('treats an unparseable address as unreachable', () => {
    expect(isBlockedIpv4('999.1.1.1')).toBe(true)
    expect(isBlockedIpv4('1.2.3')).toBe(true)
  })
})

describe('IPv6', () => {
  it.each([
    ['loopback', '::1'],
    ['unspecified', '::'],
    ['unique-local', 'fd00::1'],
    ['unique-local, low end of fc00::/7', 'fc00::1'],
    ['link-local', 'fe80::1'],
    ['link-local with a zone index', 'fe80::1%eth0'],
    ['multicast', 'ff02::1'],
  ])('blocks %s', (_label, address) => {
    expect(isBlockedIpv6(address)).toBe(true)
  })

  it('unwraps an IPv4-mapped address rather than reading only the prefix', () => {
    /*
     * `::ffff:127.0.0.1` is loopback wearing an IPv6 hat, and a check that only
     * looked at the leading hextets would wave it through — which is the single
     * most common way one of these guards is wrong.
     */
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIpv6('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedIpv6('::ffff:10.0.0.1')).toBe(true)
  })

  it('allows a public IPv6 address', () => {
    expect(isBlockedIpv6('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })

  it('routes by shape, so a caller does not have to know which family it has', () => {
    expect(isBlockedAddress('::1')).toBe(true)
    expect(isBlockedAddress('127.0.0.1')).toBe(true)
    expect(isBlockedAddress('93.184.216.34')).toBe(false)
  })
})

describe('checkEgress', () => {
  it('allows a hostname that resolves publicly', async () => {
    const result = await checkEgress('https://hotel-example.test/', resolving('93.184.216.34'))

    expect(result.ok).toBe(true)
  })

  it('refuses a hostname that resolves to a private address', async () => {
    const result = await checkEgress('https://internal.test/', resolving('10.0.0.5'))

    expect(result).toEqual({ ok: false, reason: 'private-address' })
  })

  it('refuses a hostname with one public and one private record', async () => {
    /*
     * The bypass that works eventually.
     *
     * Checking only the first address makes this a coin flip on resolver
     * ordering, and an attacker gets to flip it as often as they like.
     */
    const result = await checkEgress(
      'https://mixed.test/',
      resolving('93.184.216.34', '169.254.169.254'),
    )

    expect(result).toEqual({ ok: false, reason: 'private-address' })
  })

  it('refuses the metadata endpoint by address, without asking DNS', async () => {
    const result = await checkEgress('http://169.254.169.254/latest/meta-data/', async () => {
      throw new Error('a literal address must not reach the resolver')
    })

    expect(result).toEqual({ ok: false, reason: 'private-address' })
  })

  it('refuses the metadata endpoint by name', async () => {
    // Belt and braces: it resolves to 169.254.169.254 and would be caught
    // anyway — but only if DNS answers, and the resolver inside a cloud network
    // is precisely the one that answers.
    const result = await checkEgress('http://metadata.google.internal/', resolving('8.8.8.8'))

    expect(result).toEqual({ ok: false, reason: 'metadata-host' })
  })

  it('refuses localhost by name even when a resolver claims otherwise', async () => {
    const result = await checkEgress('http://localhost:54421/rest/v1/', resolving('93.184.216.34'))

    expect(result).toEqual({ ok: false, reason: 'metadata-host' })
  })

  it('refuses a scheme that is not http or https', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://x.test/', 'data:text/html,<h1>x</h1>']) {
      expect(await checkEgress(url, resolving('93.184.216.34'))).toEqual({
        ok: false,
        reason: 'scheme',
      })
    }
  })

  it('refuses a bracketed private IPv6 literal', async () => {
    const result = await checkEgress('http://[::1]:8080/', async () => {
      throw new Error('a literal address must not reach the resolver')
    })

    expect(result).toEqual({ ok: false, reason: 'private-address' })
  })

  it('refuses a trailing-dot hostname that would otherwise dodge the name list', async () => {
    // `localhost.` is the same name to a resolver and a different string to a
    // naive `Set.has`.
    const result = await checkEgress('http://localhost./', resolving('93.184.216.34'))

    expect(result).toEqual({ ok: false, reason: 'metadata-host' })
  })

  it('refuses a name that does not resolve rather than trying anyway', async () => {
    const result = await checkEgress('https://nope.test/', async () => {
      throw new Error('NXDOMAIN')
    })

    expect(result).toEqual({ ok: false, reason: 'unresolvable' })
  })

  it('refuses a name that resolves to nothing at all', async () => {
    const result = await checkEgress('https://empty.test/', async () => [])

    expect(result).toEqual({ ok: false, reason: 'unresolvable' })
  })

  it('refuses something that is not a URL', async () => {
    expect(await checkEgress('not a url', resolving('93.184.216.34'))).toEqual({
      ok: false,
      reason: 'unparseable',
    })
  })
})
