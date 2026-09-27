/**
 * Machine-readable zone parsing (ICAO Doc 9303), for pre-arrival capture (WP0.4).
 *
 * A vision model reads the MRZ lines off a photo; this file decides whether
 * what it read is internally consistent. The check digits are arithmetic, so
 * they are computed here in TypeScript — never trusted from a model — and a
 * document whose digits do not add up is marked invalid and the guest is asked
 * for a clearer photo.
 *
 * **This is not identity verification** (ADR-027). Valid check digits mean the
 * characters were read consistently; they say nothing about whether the person
 * holding the document is its holder. BookOne never asserts that.
 *
 * Supported: TD3 (passports, 2 × 44) and TD1 (identity cards, 3 × 30 — the back
 * of the Italian CIE and most EU cards). TD2 (2 × 36) is rare in this market and
 * falls through as unrecognised, which sends it to a person.
 */

export type MrzFormat = 'TD1' | 'TD3'

export interface MrzResult {
  format: MrzFormat
  /** First letter of the document code: `P` passport, `I`/`A`/`C` identity card. */
  documentKind: 'passport' | 'idCard'
  issuingState: string
  documentNumber: string
  nationality: string
  /** ISO date, or null when the digits are not a date. */
  birthDate: string | null
  sex: 'm' | 'f' | null
  expiryDate: string | null
  surname: string
  givenNames: string
  checks: {
    documentNumber: boolean
    birthDate: boolean
    expiryDate: boolean
    composite: boolean
  }
  /** Every check digit agrees. Anything less asks the guest for another photo. */
  valid: boolean
}

/** ICAO 9303 character values: digits as themselves, A–Z as 10–35, filler `<` as 0. */
function charValue(char: string): number {
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48
  if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55
  if (char === '<') return 0
  return -1
}

/** The 7-3-1 weighted check digit over a field. `null` for a character outside the MRZ alphabet. */
export function checkDigit(field: string): number | null {
  const weights = [7, 3, 1]
  let sum = 0

  for (let i = 0; i < field.length; i += 1) {
    const value = charValue(field[i]!)
    if (value < 0) return null
    sum += value * weights[i % 3]!
  }

  return sum % 10
}

function verify(field: string, digit: string): boolean {
  // `<` as a check digit means "no field"; it is valid only over an all-filler field.
  if (digit === '<') return /^<*$/.test(field)
  const expected = checkDigit(field)
  return expected !== null && String(expected) === digit
}

/** YYMMDD to ISO. Birth dates in the future roll back a century; expiry dates stay in this one. */
function toIsoDate(yymmdd: string, kind: 'birth' | 'expiry', now: Date): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null

  const yy = Number(yymmdd.slice(0, 2))
  const mm = Number(yymmdd.slice(2, 4))
  const dd = Number(yymmdd.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null

  const currentYy = now.getUTCFullYear() % 100
  const century = kind === 'birth' ? (yy > currentYy ? 1900 : 2000) : 2000
  const year = century + yy

  const date = new Date(Date.UTC(year, mm - 1, dd))
  if (date.getUTCMonth() !== mm - 1) return null // 31 February and friends

  return date.toISOString().slice(0, 10)
}

function readSex(char: string): 'm' | 'f' | null {
  return char === 'M' ? 'm' : char === 'F' ? 'f' : null
}

function readNames(field: string): { surname: string; givenNames: string } {
  const [surname = '', given = ''] = field.split('<<')
  const clean = (part: string) => part.replace(/</g, ' ').replace(/\s+/g, ' ').trim()
  return { surname: clean(surname), givenNames: clean(given) }
}

function clean(field: string): string {
  return field.replace(/</g, '').trim()
}

/**
 * Normalise what a model or a person typed: upper case, no spaces, common
 * look-alikes for the filler replaced. Lines are kept in order.
 */
export function normaliseMrzLines(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.toUpperCase().replace(/\s+/g, '').replace(/[«‹]/g, '<'))
    .filter((line) => line.length > 0)
}

export function parseMrz(input: readonly string[], now: Date = new Date()): MrzResult | null {
  const lines = normaliseMrzLines(input)

  if (lines.length === 2 && lines.every((line) => line.length === 44)) return parseTd3(lines, now)
  if (lines.length === 3 && lines.every((line) => line.length === 30)) return parseTd1(lines, now)

  return null
}

function parseTd3([l1, l2]: string[], now: Date): MrzResult | null {
  if (!l1 || !l2 || l1[0] !== 'P') return null

  const documentNumber = l2.slice(0, 9)
  const birth = l2.slice(13, 19)
  const expiry = l2.slice(21, 27)
  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43)

  const checks = {
    documentNumber: verify(documentNumber, l2[9]!),
    birthDate: verify(birth, l2[19]!),
    expiryDate: verify(expiry, l2[27]!),
    composite: verify(composite, l2[43]!),
  }

  return {
    format: 'TD3',
    documentKind: 'passport',
    issuingState: clean(l1.slice(2, 5)),
    documentNumber: clean(documentNumber),
    nationality: clean(l2.slice(10, 13)),
    birthDate: toIsoDate(birth, 'birth', now),
    sex: readSex(l2[20]!),
    expiryDate: toIsoDate(expiry, 'expiry', now),
    ...readNames(l1.slice(5)),
    checks,
    valid: Object.values(checks).every(Boolean),
  }
}

function parseTd1([l1, l2, l3]: string[], now: Date): MrzResult | null {
  if (!l1 || !l2 || !l3 || !['I', 'A', 'C'].includes(l1[0]!)) return null

  const documentNumber = l1.slice(5, 14)
  const birth = l2.slice(0, 6)
  const expiry = l2.slice(8, 14)
  const composite = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29)

  const checks = {
    documentNumber: verify(documentNumber, l1[14]!),
    birthDate: verify(birth, l2[6]!),
    expiryDate: verify(expiry, l2[14]!),
    composite: verify(composite, l2[29]!),
  }

  return {
    format: 'TD1',
    documentKind: 'idCard',
    issuingState: clean(l1.slice(2, 5)),
    documentNumber: clean(documentNumber),
    nationality: clean(l2.slice(15, 18)),
    birthDate: toIsoDate(birth, 'birth', now),
    sex: readSex(l2[7]!),
    expiryDate: toIsoDate(expiry, 'expiry', now),
    ...readNames(l3),
    checks,
    valid: Object.values(checks).every(Boolean),
  }
}
