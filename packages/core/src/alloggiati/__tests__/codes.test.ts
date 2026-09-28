import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  assertFits,
  assertOfficial,
  CodeTablesError,
  createResolver,
  loadCodeTables,
  parsePlaces,
  type CodeResolver,
  type CodeTables,
} from '../codes'
import { resolveParty } from '../resolve'
import { buildPayload, FIELDS, RECORD_WIDTH, type GuestDetails } from '../record'

/**
 * The registry's code tables and the resolver (WP1.2), against the synthetic
 * tables in `content/alloggiati/synthetic`: codes that exist nowhere, so a
 * test can never teach anybody a wrong real code.
 */
const DIR = fileURLToPath(new URL('../../../../../content/alloggiati/synthetic', import.meta.url))
const ON = '2026-10-01'
const STAY = { arrivalDate: ON, departureDate: '2026-10-03' }

let tables: CodeTables
let codes: CodeResolver

beforeAll(async () => {
  tables = await loadCodeTables(DIR)
  codes = createResolver(tables)
})

/** The WP1.2 fixture guests: an Italian identity card, an EU passport, a non-EU passport. */
const italian: GuestDetails = {
  surname: 'Rossi',
  givenName: 'Maria',
  sex: 'f',
  birthDate: '1980-04-12',
  birthCountryCode: 'IT',
  citizenshipCode: 'IT',
  birthPlaceCode: 'Trieste',
  documentType: 'idCard',
  documentNumber: 'CA00000AA',
  documentIssuerCode: 'Trieste',
}
const french: GuestDetails = {
  surname: 'Dupont',
  givenName: 'Léa',
  sex: 'f',
  birthDate: '1990-07-01',
  birthCountryCode: 'FR',
  citizenshipCode: 'FR',
  birthPlaceCode: 'Lyon',
  documentType: 'passport',
  documentNumber: '19FR00000',
  documentIssuerCode: 'FR',
}
const japanese: GuestDetails = {
  surname: 'Tanaka',
  givenName: 'Kenji',
  sex: 'm',
  birthDate: '1975-02-20',
  birthCountryCode: 'JP',
  citizenshipCode: 'JP',
  documentType: 'passport',
  documentNumber: 'TZ0000000',
  documentIssuerCode: 'JP',
}

describe('the tables', () => {
  it('load with their provenance, and a real channel refuses synthetic ones', () => {
    expect(tables.source).toBe('synthetic')
    expect(() => assertOfficial(tables)).toThrow(CodeTablesError)
  })

  it('tell comuni from states by the province column', () => {
    expect(tables.places.find((place) => place.name === 'TRIESTE')).toMatchObject({
      kind: 'comune',
      province: 'TS',
    })
    expect(tables.places.find((place) => place.name === 'FRANCIA')).toMatchObject({
      kind: 'stato',
      province: null,
    })
    expect(tables.places.find((place) => place.name === 'JUGOSLAVIA')?.endedOn).toBe('2006-12-31')
  })

  it('refuse a code too long for its field, instead of letting the builder clip it', () => {
    expect(() =>
      assertFits({ ...tables, documents: [{ code: 'SYNIDE', name: 'TOO LONG' }] }),
    ).toThrow(/longer than the 5-character field/)
    expect(() => assertFits(tables)).not.toThrow()
  })

  it('say which column is missing rather than loading nonsense', () => {
    expect(() => parsePlaces('Foo;Bar\n1;2')).toThrow(/no "codice" column/)
  })
})

describe('resolving what a guest wrote', () => {
  it('finds a country by its Italian name, and by an alias where the registry spells it differently', () => {
    expect(codes.country('fr', ON)).toEqual({ ok: true, code: 'SYN100002' })
    expect(codes.country('US', ON)).toEqual({ ok: true, code: 'SYN100008' })
  })

  it('refuses a country it cannot find, saying which', () => {
    const result = codes.country('BR', ON)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problem).toMatch(/BR \(Brasile\)/)
    expect(codes.country('France', ON).ok).toBe(false)
  })

  it('finds a comune regardless of case and accents', () => {
    expect(codes.comune('san dorligo della valle', ON)).toMatchObject({
      ok: true,
      code: 'SYN000006',
      province: 'TS',
    })
  })

  it('asks for the province when a name is shared, and uses it when given', () => {
    const shared = codes.comune('Castro', ON)
    expect(shared.ok).toBe(false)
    expect(!shared.ok && shared.problem).toMatch(/LE, BG.*“CASTRO \(LE\)”/)
    expect(codes.comune('Castro (bg)', ON)).toMatchObject({ ok: true, code: 'SYN000005' })
  })

  it('names a misspelt comune so the desk can correct it', () => {
    const result = codes.comune('Tristee', ON)
    expect(!result.ok && result.problem).toBe(
      "“Tristee” is not a comune in the registry's list; check the spelling",
    )
  })

  it('does not accept a three-letter country code as an issuer', () => {
    const result = codes.issuer('FRA', ON)
    expect(!result.ok && result.problem).toMatch(/three-letter country code/)
  })
})

describe('a party, resolved', () => {
  it('turns the three fixture guests into codes and a file of the right width', () => {
    const { party, issues } = resolveParty([italian, french, japanese], STAY, codes)
    expect(issues).toEqual([])

    expect(party[0]).toMatchObject({
      birthCountryCode: 'SYN100001',
      birthPlaceCode: 'SYN000001',
      birthProvince: 'TS',
      documentTypeCode: 'SYNID',
      documentIssuerCode: 'SYN000001',
    })
    // Born abroad: the state carries it; "Lyon" never reaches a code field.
    expect(party[1]).not.toHaveProperty('birthPlaceCode')
    expect(party[1]).toMatchObject({ citizenshipCode: 'SYN100002', documentTypeCode: 'SYNPA' })
    expect(party[2]).toMatchObject({
      citizenshipCode: 'SYN100009',
      documentIssuerCode: 'SYN100009',
    })

    const lines = buildPayload(party, STAY).split('\r\n')
    expect(lines.every((line) => line.length === RECORD_WIDTH)).toBe(true)
    const offset = FIELDS.slice(
      0,
      FIELDS.findIndex((field) => field.name === 'citizenshipCode'),
    )
      .map((field) => field.width)
      .reduce((a, b) => a + b, 0)
    expect(lines[2]!.slice(offset, offset + 9)).toBe('SYN100009')
  })

  it('lists every problem at once, for the guest it belongs to', () => {
    const { issues } = resolveParty(
      [
        { ...italian, birthPlaceCode: 'Tristee', documentIssuerCode: 'ITA' },
        { ...french, citizenshipCode: 'BR' },
      ],
      STAY,
      codes,
    )
    expect(issues.map((issue) => [issue.guestIndex, issue.field])).toEqual([
      [0, 'birthPlace'],
      [0, 'documentIssuer'],
      [1, 'citizenship'],
    ])
  })

  it('requires the document of the head of the party, not of the others', () => {
    const { documentType: _t, documentNumber: _n, documentIssuerCode: _i, ...bare } = french
    expect(resolveParty([bare], STAY, codes).issues.map((issue) => issue.field)).toEqual([
      'documentType',
      'documentNumber',
      'documentIssuer',
    ])
    expect(resolveParty([italian, bare], STAY, codes).issues).toEqual([])
  })
})
