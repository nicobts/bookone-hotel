import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComplianceAdapter } from './adapter'
import {
  REGISTRY,
  authorityOf,
  coverageFor,
  readJurisdiction,
  resolveAdapters,
  type Registry,
} from './registry'

const trieste = { region: 'IT-36', comune: '032006' }

describe('the region registry', () => {
  it('loads and validates', () => {
    expect(REGISTRY.national.length).toBeGreaterThan(0)
  })

  it('a property in Trieste owes the Questura, the Regione and the comune', () => {
    const coverage = coverageFor(trieste)
    expect(coverage.regionKnown && coverage.comuneKnown).toBe(true)
    expect(coverage.entries.map((entry) => [entry.level, entry.obligation])).toEqual([
      ['national', 'guest_registration'],
      ['region', 'istat_movement'],
      ['comune', 'tourist_tax_declaration'],
    ])
  })

  it('a property without a jurisdiction, or outside the registry, still owes the national filing', () => {
    for (const jurisdiction of [null, { region: 'IT-99', comune: '099001' }]) {
      const coverage = coverageFor(jurisdiction)
      expect(coverage.regionKnown).toBe(false)
      expect(coverage.entries.map((entry) => entry.level)).toEqual(['national'])
    }
  })

  it('a known region with an unknown comune has no municipal filing, and says so', () => {
    const coverage = coverageFor({ region: 'IT-36', comune: '030129' })
    expect(coverage).toMatchObject({ regionKnown: true, comuneKnown: false })
    expect(coverage.entries.some((entry) => entry.level === 'comune')).toBe(false)
  })

  it('a new region is data only: a fictional one works with no code change', () => {
    const registry: Registry = {
      ...REGISTRY,
      regions: {
        ...REGISTRY.regions,
        'IT-98': {
          name: 'Fictional',
          regional: [
            {
              adapter: 'fictional-istat',
              authority: 'regione-fictional',
              obligation: 'istat_movement',
            },
          ],
          comuni: {
            '098001': {
              name: 'Fictional town',
              municipal: [
                {
                  adapter: 'fictional-tax',
                  authority: 'comune-fictional',
                  obligation: 'tourist_tax_declaration',
                },
              ],
            },
          },
        },
      },
    }
    const coverage = coverageFor({ region: 'IT-98', comune: '098001' }, registry)
    expect(coverage.entries.map((entry) => entry.adapter)).toEqual([
      'alloggiati',
      'fictional-istat',
      'fictional-tax',
    ])
  })

  it('reports registry entries that have no implementation instead of guessing', () => {
    const fake = { capabilities: () => ({ id: 'alloggiati' }) } as unknown as ComplianceAdapter
    const coverage = coverageFor(trieste)

    const registration = resolveAdapters(
      coverage,
      new Map([['alloggiati', fake]]),
      'guest_registration',
    )
    expect(registration.resolved.map((r) => r.entry.adapter)).toEqual(['alloggiati'])
    expect(registration.missing).toEqual([])

    const istat = resolveAdapters(coverage, new Map([['alloggiati', fake]]), 'istat_movement')
    expect(istat.resolved).toEqual([])
    expect(istat.missing.map((entry) => entry.adapter)).toEqual(['webtur-fvg'])
  })

  it('reads the jurisdiction from settings, and nothing from a malformed one', () => {
    expect(readJurisdiction({ jurisdiction: trieste })).toEqual(trieste)
    expect(readJurisdiction({ jurisdiction: { region: 'FVG', comune: '32006' } })).toBeNull()
    expect(readJurisdiction({})).toBeNull()
    expect(readJurisdiction(null)).toBeNull()
  })

  it('names the authority each adapter files with, from the registry', () => {
    expect(authorityOf('alloggiati')).toBe('questura')
    expect(authorityOf('webtur-fvg')).toBe('regione-fvg')
    expect(authorityOf('nothing')).toBeNull()
  })

  it('no compliance code branches on a region or comune (ADR-028)', () => {
    const dir = __dirname
    const codes = [
      ...Object.keys(REGISTRY.regions),
      ...Object.values(REGISTRY.regions).flatMap((region) => Object.keys(region.comuni)),
      ...Object.values(REGISTRY.regions).map((region) => region.name),
    ]
    for (const file of readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )) {
      const source = readFileSync(join(dir, file), 'utf8')
      for (const code of codes) expect(source.includes(code), `${file} names ${code}`).toBe(false)
    }
  })
})
