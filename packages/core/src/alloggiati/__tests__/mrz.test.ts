import { describe, expect, it } from 'vitest'
import { checkDigit, normaliseMrzLines, parseMrz } from '../mrz'

/**
 * MRZ parsing (WP0.4). Fixtures are the specimen documents published in ICAO
 * Doc 9303 — fictional holders of the fictional state "UTO" — so no real
 * person's data is in this repository.
 */
const NOW = new Date('2026-09-27T00:00:00Z')

const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
]

const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
]

describe('check digits (7-3-1)', () => {
  it('matches the ICAO worked examples', () => {
    expect(checkDigit('L898902C3')).toBe(6)
    expect(checkDigit('740812')).toBe(2)
    expect(checkDigit('120415')).toBe(9)
  })

  it('refuses a character outside the MRZ alphabet', () => {
    expect(checkDigit('L8989é2C3')).toBeNull()
  })
})

describe('a passport (TD3)', () => {
  it('reads every field and validates every digit', () => {
    expect(parseMrz(TD3, NOW)).toEqual({
      format: 'TD3',
      documentKind: 'passport',
      issuingState: 'UTO',
      documentNumber: 'L898902C3',
      nationality: 'UTO',
      birthDate: '1974-08-12',
      sex: 'f',
      expiryDate: '2012-04-15',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      checks: { documentNumber: true, birthDate: true, expiryDate: true, composite: true },
      valid: true,
      repaired: false,
    })
  })

  it('marks a misread digit invalid — the guest is asked for a clearer photo', () => {
    // One character misread by OCR: 2 → 3 in the document number.
    const misread = [TD3[0]!, TD3[1]!.replace('L898902C3', 'L898903C3')]
    const result = parseMrz(misread, NOW)

    expect(result?.valid).toBe(false)
    expect(result?.checks.documentNumber).toBe(false)
  })

  it('documents the limit of a mod-10 check: two misreads can cancel out', () => {
    // 8 → 3 at weights 3 and 7 changes the sum by −15 and −35: −50, a multiple
    // of ten, so the field digit still matches. This is why a failed check sends
    // the guest back for another photo, but a passed check is not proof — the
    // staff confirmation step exists for what arithmetic cannot see.
    const cancelling = [TD3[0]!, TD3[1]!.replace('L898902C3', 'L393902C3')]
    expect(parseMrz(cancelling, NOW)?.checks.documentNumber).toBe(true)
  })

  it('catches a swapped birth date through its own digit and the composite', () => {
    const swapped = [TD3[0]!, TD3[1]!.replace('7408122', '7408212')]
    expect(parseMrz(swapped, NOW)?.valid).toBe(false)
  })
})

describe('an identity card (TD1, e.g. the back of a CIE)', () => {
  it('reads every field and validates every digit', () => {
    const result = parseMrz(TD1, NOW)

    expect(result).toMatchObject({
      format: 'TD1',
      documentKind: 'idCard',
      documentNumber: 'D23145890',
      birthDate: '1974-08-12',
      sex: 'f',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      valid: true,
    })
  })

  it('marks a broken composite invalid even when each field digit happens to pass', () => {
    const broken = [TD1[0]!, TD1[1]!.slice(0, 29) + '0', TD1[2]!]
    const result = parseMrz(broken, NOW)

    expect(result?.checks.composite).toBe(false)
    expect(result?.valid).toBe(false)
  })
})

describe('what is not an MRZ', () => {
  it('returns null for the wrong shape — a person reads it instead', () => {
    expect(parseMrz(['P<UTO', 'L898902C36'], NOW)).toBeNull()
    expect(parseMrz([], NOW)).toBeNull()
  })

  it('tolerates spacing and lower case from a model or a person typing it', () => {
    expect(normaliseMrzLines([' p<uto eriksson ', ''])).toEqual(['P<UTOERIKSSON'])
  })
})

describe('filler repair', () => {
  it('fixes the miscount a vision model actually made, and the digits confirm it', () => {
    // Observed live (2026-09-27): four fillers instead of five before the final
    // two digits, so line 2 came back 43 characters long.
    const miscounted = [TD3[0]!, 'L898902C36UTO7408122F1204159ZE184226B<<<<10']
    const result = parseMrz(miscounted, NOW)

    expect(result).toMatchObject({ valid: true, repaired: true, documentNumber: 'L898902C3' })
  })

  it('never turns a misread into a pass: a repaired line still has to agree with its digits', () => {
    // Short by one filler *and* a misread digit: the length is repaired, the
    // document still fails.
    const both = [TD3[0]!, 'L898903C36UTO7408122F1204159ZE184226B<<<<10']
    expect(parseMrz(both, NOW)).toMatchObject({ valid: false, repaired: true })
  })

  it('leaves a line more than three characters off alone — that is a misread, not a miscount', () => {
    expect(parseMrz([TD3[0]!, 'L898902C36UTO7408122F1204159ZE184226B10'], NOW)).toBeNull()
  })
})
