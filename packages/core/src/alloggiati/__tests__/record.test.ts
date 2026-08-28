import { describe, expect, it } from 'vitest'
import {
  buildPayload,
  documentTypes,
  FIELDS,
  guestTypes,
  RECORD_WIDTH,
  validateParty,
  type GuestDetails,
} from '../record'

/**
 * The payload builder (E2.3).
 *
 * Pure, so it is tested without a channel. Note what these tests can and cannot
 * establish: they prove the file is *well formed* — right widths, right
 * padding, right codes for the shape of the party — and they cannot prove the
 * offsets match the authority's current specification. That check is a person
 * with the official document, on the go-live checklist in
 * docs/runbooks/alloggiati.md.
 *
 * The distinction matters. A width bug is caught here; a field-order bug is
 * caught by the authority rejecting the file, which is why shipping behind a
 * mock is safe and shipping to a property without the check is not.
 */

const guest = (overrides: Partial<GuestDetails> = {}): GuestDetails => ({
  surname: 'Weber',
  givenName: 'Rosa',
  sex: 'f',
  birthDate: '1985-04-12',
  birthCountryCode: 'AT',
  citizenshipCode: 'AT',
  ...overrides,
})

const stay = { arrivalDate: '2026-09-03', departureDate: '2026-09-06' }

describe('the record layout', () => {
  it('is 168 characters, the documented record length', () => {
    // A field added without adjusting this fails here rather than three weeks
    // later when the authority rejects a file.
    expect(RECORD_WIDTH).toBe(168)
  })

  it('declares a positive width for every field', () => {
    for (const field of FIELDS) {
      expect(field.width).toBeGreaterThan(0)
    }
  })
})

describe('buildPayload', () => {
  it('produces one record of exactly the declared width per guest', () => {
    const payload = buildPayload([guest(), guest({ givenName: 'Hans', sex: 'm' })], stay)
    const lines = payload.split('\r\n')

    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).toHaveLength(RECORD_WIDTH)
  })

  it('files a lone guest as a single, not a party of one', () => {
    const payload = buildPayload([guest()], stay)

    // A different code, not a cosmetic difference: filing four singles for a
    // family of four is a different declaration from the one the property means.
    expect(payload.slice(0, 2)).toBe(guestTypes.single)
  })

  it('files a party as a head followed by members', () => {
    const payload = buildPayload([guest(), guest({ givenName: 'Hans' })], stay)
    const [first, second] = payload.split('\r\n')

    expect(first?.slice(0, 2)).toBe(guestTypes.familyHead)
    expect(second?.slice(0, 2)).toBe(guestTypes.familyMember)
  })

  it('writes dates the way the registry does', () => {
    const payload = buildPayload([guest()], stay)

    // dd/mm/yyyy, immediately after the two-character type code.
    expect(payload.slice(2, 12)).toBe('03/09/2026')
  })

  it('counts nights, not days', () => {
    const payload = buildPayload([guest()], stay)

    // 3rd to the 6th is three nights. Departure is exclusive everywhere in this
    // codebase and the registry wants the same number.
    expect(payload.slice(12, 14)).toBe('03')
  })

  it('strips accents rather than shifting every field after the name', () => {
    const payload = buildPayload([guest({ surname: 'Müller', givenName: 'Sofía' })], stay)

    // A fixed-width file counts bytes, and "Müller" is six characters but seven
    // bytes in UTF-8 — which moves everything after it and produces a file the
    // authority rejects. Names in this market are full of umlauts, so this is
    // the common case rather than an edge one.
    expect(payload).toHaveLength(RECORD_WIDTH)
    expect(payload).toContain('MULLER')
    expect(payload).toContain('SOFIA')
  })

  it('keeps the width when a name is longer than its field', () => {
    const payload = buildPayload([guest({ surname: 'A'.repeat(120) })], stay)

    expect(payload).toHaveLength(RECORD_WIDTH)
  })

  it('encodes sex as the registry does', () => {
    const male = buildPayload([guest({ sex: 'm' })], stay)
    const female = buildPayload([guest({ sex: 'f' })], stay)

    expect(male).not.toBe(female)
  })

  it('maps document types to registry codes', () => {
    const payload = buildPayload([guest({ documentType: 'passport', documentNumber: 'P1' })], stay)

    expect(payload).toContain(documentTypes.passport)
  })

  it('pads an absent optional field rather than omitting it', () => {
    // Omitting would shorten the record and shift every following field. The
    // authority reads by position, not by delimiter.
    const withDocument = buildPayload([guest({ documentNumber: 'P1234567' })], stay)
    const without = buildPayload([guest()], stay)

    expect(withDocument).toHaveLength(RECORD_WIDTH)
    expect(without).toHaveLength(RECORD_WIDTH)
  })

  it('caps an implausible stay rather than wrapping the field', () => {
    const payload = buildPayload([guest()], {
      arrivalDate: '2026-01-01',
      departureDate: '2027-01-01',
    })

    // 365 nights does not fit two characters. A visible cap beats a wrapped
    // number that reads as a plausible short stay.
    expect(payload.slice(12, 14)).toBe('99')
    expect(payload).toHaveLength(RECORD_WIDTH)
  })
})

describe('validateParty', () => {
  it('accepts a complete party', () => {
    expect(validateParty([guest()], stay)).toEqual([])
  })

  it('refuses an empty party', () => {
    expect(validateParty([], stay)).toHaveLength(1)
  })

  it('reports every problem, not the first', () => {
    // The console shows this to an owner who has to go and ask the guest. A
    // list that reveals one missing field per round trip takes four
    // conversations.
    const issues = validateParty([{ surname: 'Weber' }, { givenName: 'Hans' }], stay)

    expect(issues.length).toBeGreaterThan(2)
    expect(new Set(issues.map((issue) => issue.guestIndex))).toEqual(new Set([0, 1]))
  })

  it('names the guest and the field, so the owner knows who to ask', () => {
    const issues = validateParty([guest(), { surname: 'Weber', givenName: 'Hans' }], stay)

    expect(issues.every((issue) => issue.guestIndex === 1)).toBe(true)
    expect(issues.map((issue) => issue.field)).toContain('sex')
  })

  it('rejects a stay that ends before it starts', () => {
    const issues = validateParty([guest()], {
      arrivalDate: '2026-09-06',
      departureDate: '2026-09-03',
    })

    expect(issues.some((issue) => issue.field === 'stay')).toBe(true)
  })

  it('rejects a malformed birth date rather than filing it', () => {
    const issues = validateParty([guest({ birthDate: '12/04/1985' })], stay)

    expect(issues.some((issue) => issue.field === 'birthDate')).toBe(true)
  })
})
