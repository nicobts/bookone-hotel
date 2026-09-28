import { describe, expect, it } from 'vitest'
import { dailyMovement, daysBetween, originOf, type MovementStay } from './istat'

/**
 * WP1.3 acceptance: 30 consecutive simulated days produce the right daily
 * series, checked against a series computed by hand (below), not by the same
 * code. Zero-presence days are in it.
 */
const resident = (country: string, province?: string) => ({
  residenceCountry: country,
  ...(province ? { residenceProvince: province } : {}),
})

const STAYS: MovementStay[] = [
  // A: two French residents, 1 → 4 Oct (nights 1, 2, 3).
  {
    reference: 'A',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-04',
    partySize: 2,
    guests: [resident('FR'), resident('FR')],
  },
  // B: one Triestino, 3 → 5 Oct (nights 3, 4).
  {
    reference: 'B',
    arrivalDate: '2026-10-03',
    departureDate: '2026-10-05',
    partySize: 1,
    guests: [resident('IT', 'TS')],
  },
  // C: two guests, one recorded by citizenship only (DE), one not recorded at all; 10 → 12 Oct.
  {
    reference: 'C',
    arrivalDate: '2026-10-10',
    departureDate: '2026-10-12',
    partySize: 2,
    guests: [{ citizenship: 'de' }],
  },
  // D: three US residents, 15 → 22 Oct (seven nights).
  {
    reference: 'D',
    arrivalDate: '2026-10-15',
    departureDate: '2026-10-22',
    partySize: 3,
    guests: [resident('US'), resident('US'), resident('US')],
  },
  // E: one Austrian, 20 → 21 Oct.
  {
    reference: 'E',
    arrivalDate: '2026-10-20',
    departureDate: '2026-10-21',
    partySize: 1,
    guests: [resident('AT')],
  },
  // F: two from Udine, arrived before the period (28 Sep → 2 Oct).
  {
    reference: 'F',
    arrivalDate: '2026-09-28',
    departureDate: '2026-10-02',
    partySize: 2,
    guests: [resident('IT', 'UD'), resident('IT', 'UD')],
  },
  // G: one Slovenian, leaving after the period (29 Oct → 2 Nov).
  {
    reference: 'G',
    arrivalDate: '2026-10-29',
    departureDate: '2026-11-02',
    partySize: 1,
    guests: [resident('SI')],
  },
  // H: nonsense dates, ignored.
  {
    reference: 'H',
    arrivalDate: '2026-10-08',
    departureDate: '2026-10-08',
    partySize: 1,
    guests: [resident('FR')],
  },
]

/** Worked out by hand, day by day: [arrivals, departures, presences, rooms]. */
const EXPECTED: Record<string, [number, number, number, number]> = {
  '2026-10-01': [2, 0, 4, 2], // A arrives (2); A and F sleep (2 + 2)
  '2026-10-02': [0, 2, 2, 1], // F leaves (2); A sleeps
  '2026-10-03': [1, 0, 3, 2], // B arrives; A (2) and B (1) sleep
  '2026-10-04': [0, 2, 1, 1], // A leaves; B sleeps
  '2026-10-05': [0, 1, 0, 0], // B leaves
  '2026-10-10': [2, 0, 2, 1], // C arrives (party of two)
  '2026-10-11': [0, 0, 2, 1],
  '2026-10-12': [0, 2, 0, 0], // C leaves
  '2026-10-15': [3, 0, 3, 1], // D arrives
  '2026-10-16': [0, 0, 3, 1],
  '2026-10-17': [0, 0, 3, 1],
  '2026-10-18': [0, 0, 3, 1],
  '2026-10-19': [0, 0, 3, 1],
  '2026-10-20': [1, 0, 4, 2], // E arrives; D (3) and E (1) sleep
  '2026-10-21': [0, 1, 3, 1], // E leaves
  '2026-10-22': [0, 3, 0, 0], // D leaves
  '2026-10-29': [1, 0, 1, 1], // G arrives
  '2026-10-30': [0, 0, 1, 1],
}

describe('the daily movement series (WP1.3)', () => {
  const series = dailyMovement(STAYS, '2026-10-01', '2026-10-30')

  it('has every one of the 30 days, in order', () => {
    expect(series.map((day) => day.day)).toEqual(daysBetween('2026-10-01', '2026-10-30'))
    expect(series).toHaveLength(30)
  })

  it('matches the hand-computed series on every day, zero days included', () => {
    for (const day of series) {
      const expected = EXPECTED[day.day] ?? [0, 0, 0, 0]
      expect(
        [day.totals.arrivals, day.totals.departures, day.totals.presences, day.roomsOccupied],
        day.day,
      ).toEqual(expected)
    }
  })

  it('reports the zero-presence days rather than leaving them out', () => {
    const quiet = series.filter((day) => day.totals.presences === 0).map((day) => day.day.slice(8))
    expect(quiet).toEqual([
      '05',
      '06',
      '07',
      '08',
      '09',
      '12',
      '13',
      '14',
      '22',
      '23',
      '24',
      '25',
      '26',
      '27',
      '28',
    ])
  })

  it('adds up over the period: 10 arrivals, 11 departures, 38 presences', () => {
    const sum = (field: 'arrivals' | 'departures' | 'presences') =>
      series.reduce((total, day) => total + day.totals[field], 0)
    expect([sum('arrivals'), sum('departures'), sum('presences')]).toEqual([10, 11, 38])
  })

  it('splits by origin: country for foreign residents, province for Italian ones', () => {
    const first = series[0]!
    expect(first.byOrigin).toEqual({
      FR: { arrivals: 2, departures: 0, presences: 2 },
      'IT-UD': { arrivals: 0, departures: 0, presences: 2 },
    })
    expect(series[2]!.byOrigin['IT-TS']).toEqual({ arrivals: 1, departures: 0, presences: 1 })
  })

  it('says who was counted by citizenship, and whose record is missing', () => {
    const tenth = series.find((day) => day.day === '2026-10-10')!
    expect(tenth.byOrigin).toEqual({
      DE: { arrivals: 1, departures: 0, presences: 1 },
      unknown: { arrivals: 1, departures: 0, presences: 1 },
    })
    expect(tenth.byCitizenship).toBe(1)
    expect(tenth.unknownIn).toEqual(['C'])
    expect(series.find((day) => day.day === '2026-10-12')!.unknownIn).toEqual(['C'])
    expect(series.find((day) => day.day === '2026-10-13')!.unknownIn).toEqual([])
  })
})

describe('origin', () => {
  it('prefers residence, falls back to citizenship, and says so', () => {
    expect(originOf({ residenceCountry: 'it', residenceProvince: 'ts' })).toEqual({
      origin: 'IT-TS',
      byCitizenship: false,
    })
    expect(originOf({ residenceCountry: 'IT' })).toEqual({ origin: 'IT', byCitizenship: false })
    expect(originOf({ citizenship: 'fr' })).toEqual({ origin: 'FR', byCitizenship: true })
    expect(originOf(undefined)).toEqual({ origin: 'unknown', byCitizenship: false })
  })
})

describe('the adapters and their features', () => {
  it('agree with the inbox map', async () => {
    const { ADAPTER_FEATURES } = await import('./features')
    const { webturCapabilities } = await import('./webtur')
    const { alloggiatiCapabilities } = await import('./alloggiati')
    for (const capabilities of [webturCapabilities(true), alloggiatiCapabilities(true)]) {
      expect(ADAPTER_FEATURES[capabilities.id]).toBe(capabilities.feature)
    }
  })
})
