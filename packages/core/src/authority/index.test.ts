import { describe, expect, it } from 'vitest'
import {
  defaultAuthority,
  domains,
  FiscalAuthorityError,
  resolveAuthority,
  routeWrite,
  validateAuthorityMap,
  type Domain,
} from './index'

describe('resolveAuthority', () => {
  it('falls back to the V1 default when a property says nothing', () => {
    expect(resolveAuthority({}, 'booking')).toBe('platform')
    expect(resolveAuthority({}, 'availability')).toBe('pms')
  })

  it('honours an explicit graduation', () => {
    // The whole thesis in one assertion: graduating a domain is flipping a
    // value, not migrating a product (ADR-001).
    expect(resolveAuthority({ availability: 'platform' }, 'availability')).toBe('platform')
  })

  it('ignores unknown keys', () => {
    expect(resolveAuthority({ nonsense: 'platform' }, 'booking')).toBe('platform')
  })

  it('falls back rather than trusting an unrecognised value', () => {
    // `authority_map` is jsonb, so anything can be in it. A typo must not move
    // authority — the safe reading is the default, not the odd string.
    expect(resolveAuthority({ availability: 'PLATFORM' }, 'availability')).toBe('pms')
    expect(resolveAuthority({ availability: true }, 'availability')).toBe('pms')
    expect(resolveAuthority({ booking: null }, 'booking')).toBe('platform')
  })

  it('survives a map that is not an object at all', () => {
    for (const map of [null, undefined, 'platform', 42, []]) {
      expect(resolveAuthority(map, 'booking')).toBe('platform')
    }
  })
})

describe('fiscal authority is unreachable (D11, ADR-002)', () => {
  it('resolves to pms even when a property row says otherwise', () => {
    // A property row is data: editable in a dashboard, restorable from a
    // backup, settable by a migration written in a hurry. "We would never
    // configure that" is not a control. This is.
    expect(resolveAuthority({ fiscal: 'platform' }, 'fiscal')).toBe('pms')
  })

  it('never routes a fiscal write to us', () => {
    const route = routeWrite({ fiscal: 'platform' }, 'fiscal')

    expect(route.authority).toBe('pms')
    expect(route.writeLocal).toBe(false)
  })

  it('refuses to store a map that grants it', () => {
    expect(() => validateAuthorityMap({ fiscal: 'platform' })).toThrow(FiscalAuthorityError)
  })

  it('stores fiscal: pms without complaint', () => {
    expect(validateAuthorityMap({ fiscal: 'pms' })).toEqual({ fiscal: 'pms' })
  })
})

describe('routeWrite — both routes, every domain (E6.2)', () => {
  it.each(domains)('routes %s under platform authority', (domain) => {
    const route = routeWrite({ [domain]: 'platform' }, domain)

    if (domain === 'fiscal') {
      expect(route.authority).toBe('pms')
      return
    }

    // We own it: write locally, emit, then reflect. A reflection that fails is
    // an exception the owner sees, never a lost write (PRD A3).
    expect(route).toEqual({
      authority: 'platform',
      writeLocal: true,
      reflectToPms: true,
      writeThroughToPms: false,
    })
  })

  it.each(domains)('routes %s under pms authority', (domain) => {
    const route = routeWrite({ [domain]: 'pms' }, domain)

    // They own it: write through and let sync bring it back. Writing locally
    // would create a second truth, which is the failure the dual-source
    // architecture exists to prevent.
    expect(route).toEqual({
      authority: 'pms',
      writeLocal: false,
      reflectToPms: false,
      writeThroughToPms: true,
    })
  })

  it('never both writes locally and writes through', () => {
    for (const domain of domains) {
      for (const authority of ['platform', 'pms'] as const) {
        const route = routeWrite({ [domain]: authority }, domain)
        expect(route.writeLocal && route.writeThroughToPms).toBe(false)
      }
    }
  })
})

describe('defaults', () => {
  it('covers every domain', () => {
    // A domain added without a default would resolve to undefined and route
    // nowhere. The type system catches this at compile time; this catches it
    // if the record is ever widened.
    for (const domain of domains) {
      expect(defaultAuthority[domain as Domain]).toMatch(/^(platform|pms)$/)
    }
  })

  it('makes booking the first platform-authoritative domain (D12)', () => {
    expect(defaultAuthority.booking).toBe('platform')
  })

  it('leaves rates and availability with the PMS in V1', () => {
    // Rung 5 is out of scope (00-OVERVIEW §6: no rate management authority).
    expect(defaultAuthority.rates).toBe('pms')
    expect(defaultAuthority.availability).toBe('pms')
  })
})

describe('validateAuthorityMap', () => {
  it('drops unknown keys rather than persisting them', () => {
    expect(validateAuthorityMap({ booking: 'platform', made_up: 'platform' })).toEqual({
      booking: 'platform',
    })
  })

  it('drops unrecognised values', () => {
    expect(validateAuthorityMap({ booking: 'yes' })).toEqual({})
  })

  it('returns an empty map for junk input', () => {
    for (const input of [null, undefined, 'x', 7]) {
      expect(validateAuthorityMap(input)).toEqual({})
    }
  })
})
