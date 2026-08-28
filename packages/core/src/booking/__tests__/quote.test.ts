import { describe, expect, it } from 'vitest'
import {
  nightsBetween,
  quoteStay,
  readTouristTaxPolicy,
  touristTaxNote,
  type SnapshotNight,
} from '../quote'

/**
 * Pricing is the arithmetic a guest is charged on, so it is tested without a
 * database, a connector or a browser in the way.
 */

function night(date: string, priceCents: number, id = `snap-${date}`): SnapshotNight {
  return { date, priceCents, currency: 'EUR', snapshotId: id }
}

describe('nightsBetween', () => {
  it('counts departure as exclusive', () => {
    // Arriving on the 3rd and leaving on the 5th is two nights, not three.
    // Getting this wrong overcharges every guest by one night.
    expect(nightsBetween('2026-09-03', '2026-09-05')).toEqual(['2026-09-03', '2026-09-04'])
  })

  it('returns nothing for a same-day or reversed stay', () => {
    expect(nightsBetween('2026-09-03', '2026-09-03')).toEqual([])
    expect(nightsBetween('2026-09-05', '2026-09-03')).toEqual([])
  })

  it('crosses a month, a year and a DST boundary', () => {
    expect(nightsBetween('2026-12-31', '2027-01-02')).toEqual(['2026-12-31', '2027-01-01'])

    // Europe/Rome puts the clocks back on 2026-10-25. Dates are calendar dates,
    // not instants, so the night still counts as one — a UTC-parsed date does
    // not care, which is precisely why they are parsed as UTC.
    expect(nightsBetween('2026-10-24', '2026-10-26')).toHaveLength(2)
  })
})

describe('quoteStay', () => {
  it('sums the nights and keeps their provenance in order', () => {
    const result = quoteStay('2026-09-03', '2026-09-06', [
      night('2026-09-03', 9000),
      night('2026-09-04', 9500),
      night('2026-09-05', 10_000),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.quote.totalCents).toBe(28_500)
    expect(result.quote.nightCount).toBe(3)
    expect(result.quote.snapshotIds).toEqual([
      'snap-2026-09-03',
      'snap-2026-09-04',
      'snap-2026-09-05',
    ])
  })

  it('refuses a stay with an unpriced night rather than pricing the rest', () => {
    // The room is simply not offered. Quoting three of four nights would show a
    // total cheaper than the stay, and the guest would be right to hold us to it.
    const result = quoteStay('2026-09-03', '2026-09-07', [
      night('2026-09-03', 9000),
      night('2026-09-04', 9000),
      night('2026-09-06', 9000),
    ])

    expect(result).toEqual({ ok: false, failure: { reason: 'missing-night', date: '2026-09-05' } })
  })

  it('ignores nights outside the stay', () => {
    const result = quoteStay('2026-09-03', '2026-09-04', [
      night('2026-09-02', 50_000),
      night('2026-09-03', 9000),
      night('2026-09-04', 50_000),
    ])

    expect(result.ok && result.quote.totalCents).toBe(9000)
  })

  it('refuses two currencies in one stay', () => {
    const result = quoteStay('2026-09-03', '2026-09-05', [
      night('2026-09-03', 9000),
      { ...night('2026-09-04', 9000), currency: 'CHF' },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toBe('mixed-currency')
  })

  it('refuses a stay with no nights', () => {
    expect(quoteStay('2026-09-05', '2026-09-03', [])).toEqual({
      ok: false,
      failure: { reason: 'no-nights' },
    })
  })
})

describe('touristTaxNote', () => {
  const policy = {
    amountCentsPerPersonPerNight: 200,
    currency: 'EUR',
    maxNights: 5,
    exemptUnderAge: 14,
  }

  it('charges per person per night', () => {
    const note = touristTaxNote(
      { amountCentsPerPersonPerNight: 200, currency: 'EUR' },
      { nightCount: 3, adults: 2, children: 0 },
    )

    expect(note.estimateCents).toBe(1200)
    expect(note.cappedAtNights).toBeNull()
  })

  it('stops at the cap', () => {
    const note = touristTaxNote(policy, { nightCount: 9, adults: 2, children: 0 })

    expect(note.chargeableNights).toBe(5)
    expect(note.estimateCents).toBe(2000)
    expect(note.cappedAtNights).toBe(5)
  })

  it('leaves children out of the estimate when the property exempts them by age', () => {
    // We collect a child count, never birthdates. Charging them at the adult
    // rate overstates the note; exempting them silently understates it. So the
    // estimate covers adults and the exemption is stated for the guest to read.
    const note = touristTaxNote(policy, { nightCount: 2, adults: 2, children: 2 })

    expect(note.chargeablePeople).toBe(2)
    expect(note.childrenExcluded).toBe(true)
    expect(note.exemptUnderAge).toBe(14)
  })

  it('counts children when the property exempts nobody', () => {
    const note = touristTaxNote(
      { amountCentsPerPersonPerNight: 150, currency: 'EUR' },
      { nightCount: 2, adults: 2, children: 1 },
    )

    expect(note.chargeablePeople).toBe(3)
    expect(note.childrenExcluded).toBe(false)
    expect(note.estimateCents).toBe(900)
  })
})

describe('readTouristTaxPolicy', () => {
  it('reads a well-formed policy out of settings', () => {
    const policy = readTouristTaxPolicy({
      touristTax: { amountCentsPerPersonPerNight: 200, currency: 'EUR', maxNights: 5 },
    })

    expect(policy?.amountCentsPerPersonPerNight).toBe(200)
  })

  it.each([
    ['no settings', null],
    ['no tax configured', {}],
    ['a string amount', { touristTax: { amountCentsPerPersonPerNight: '200' } }],
    ['a negative amount', { touristTax: { amountCentsPerPersonPerNight: -100 } }],
    ['settings that are not an object', 'nope'],
  ])('returns null for %s rather than guessing', (_label, settings) => {
    // A malformed policy must not become a charge. Null means no note is shown,
    // which is the same as a property that has not configured one — and far
    // better than stating a number derived from a typo.
    expect(readTouristTaxPolicy(settings)).toBeNull()
  })
})
