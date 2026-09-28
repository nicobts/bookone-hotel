import { describe, expect, it } from 'vitest'
import { computeStayTax, roundCentiCents, type TaxStay } from './engine'
import { buildDeclaration, declarationCsv, reconcileDeclaration } from './declaration'
import { loadAllRules, parseRules, rulesFor } from './index'

/**
 * WP1.4 acceptance, on two fictional comuni (`rules/999001.json`,
 * `rules/999002.json`): golden tests for 20 bookings, a period declaration,
 * its reconciliation to the cent, and a second comune added by a file alone.
 * Every expected amount below was worked out by hand from the rule files.
 */
const esempio = rulesFor('999001')!
const altrove = rulesFor('999002')!

const adult = { birthDate: '1980-01-01' }
const stay = (
  over: Partial<TaxStay> & Pick<TaxStay, 'arrivalDate' | 'departureDate'>,
): TaxStay => ({
  reference: 'R',
  category: 'hotel-3',
  partySize: over.guests?.length ?? 1,
  guests: [adult],
  ...over,
})

// [name, rules, stay, expected total cents, expected issues matcher]
const GOLDEN: [string, typeof esempio, TaxStay, number, RegExp | null][] = [
  [
    '1. one adult, three low-season nights (3 × 2,00)',
    esempio,
    stay({ arrivalDate: '2026-05-10', departureDate: '2026-05-13' }),
    600,
    null,
  ],
  [
    '2. two adults, two high-season nights (2 × 2 × 3,00)',
    esempio,
    stay({ arrivalDate: '2026-06-10', departureDate: '2026-06-12', guests: [adult, adult] }),
    1200,
    null,
  ],
  [
    '3. eight nights, capped at five (5 × 2,00)',
    esempio,
    stay({ arrivalDate: '2026-05-01', departureDate: '2026-05-09' }),
    1000,
    null,
  ],
  [
    '4. an adult and a child of 10: the child is exempt',
    esempio,
    stay({
      arrivalDate: '2026-05-10',
      departureDate: '2026-05-12',
      guests: [adult, { birthDate: '2016-01-01' }],
    }),
    400,
    null,
  ],
  [
    '5. a 15-year-old, three high nights at half rate (3 × 1,50)',
    esempio,
    stay({
      arrivalDate: '2026-06-01',
      departureDate: '2026-06-04',
      guests: [{ birthDate: '2011-03-01' }],
    }),
    450,
    null,
  ],
  [
    '6. a resident, declared: exempt',
    esempio,
    stay({
      arrivalDate: '2026-05-10',
      departureDate: '2026-05-12',
      guests: [{ ...adult, exemption: 'residente' }],
    }),
    0,
    null,
  ],
  [
    '7. an exemption the rules do not have: charged, and flagged',
    esempio,
    stay({
      arrivalDate: '2026-05-10',
      departureDate: '2026-05-12',
      guests: [{ ...adult, exemption: 'vip' }],
    }),
    400,
    /"vip" is not an exemption/,
  ],
  [
    '8. across the season change (2,00 + 2,00 + 3,00)',
    esempio,
    stay({ arrivalDate: '2026-05-30', departureDate: '2026-06-02' }),
    700,
    null,
  ],
  [
    '9. across the rate change on 1 July (3,00 + 3,00 + 3,50)',
    esempio,
    stay({ arrivalDate: '2026-06-29', departureDate: '2026-07-02' }),
    950,
    null,
  ],
  [
    '10. the cap in force at arrival (5), not the new one (7)',
    esempio,
    stay({ arrivalDate: '2026-06-28', departureDate: '2026-07-06' }),
    1600,
    null,
  ],
  [
    '11. the new cap: nine low nights, seven charged (7 × 2,50)',
    esempio,
    stay({ arrivalDate: '2026-10-01', departureDate: '2026-10-10' }),
    1750,
    null,
  ],
  [
    '12. a B&B, two low nights (2 × 1,00)',
    esempio,
    stay({ arrivalDate: '2026-04-01', departureDate: '2026-04-03', category: 'b&b' }),
    200,
    null,
  ],
  [
    '13. a category the comune has no rate for: nothing, and flagged',
    esempio,
    stay({ arrivalDate: '2026-04-01', departureDate: '2026-04-02', category: 'campeggio' }),
    0,
    /no rate for category "campeggio"/,
  ],
  [
    '14. a party of three, one recorded: all charged as adults, flagged',
    esempio,
    stay({ arrivalDate: '2026-05-10', departureDate: '2026-05-11', partySize: 3 }),
    600,
    /2 of 3 guests not recorded/,
  ],
  [
    '15. over the new year, low season wrapping (3 × 2,50)',
    esempio,
    stay({ arrivalDate: '2026-12-30', departureDate: '2027-01-02' }),
    750,
    null,
  ],
  [
    '16. turns 14 during the stay: the age at arrival counts, exempt',
    esempio,
    stay({
      arrivalDate: '2026-05-10',
      departureDate: '2026-05-12',
      guests: [{ birthDate: '2012-05-11' }],
    }),
    0,
    null,
  ],
  [
    '17. 17 at arrival, 18 two days later: reduced (2 × 1,00)',
    esempio,
    stay({
      arrivalDate: '2026-05-10',
      departureDate: '2026-05-12',
      guests: [{ birthDate: '2008-05-12' }],
    }),
    200,
    null,
  ],
  [
    '18. partly before the rules existed: only the covered night, flagged',
    esempio,
    stay({ arrivalDate: '2024-12-30', departureDate: '2025-01-02' }),
    200,
    /no rules in force on 2024-12-30/,
  ],
  [
    '19. second comune: an adult and a 76-year-old, rounded once per stay (540 + 361,8 → 362)',
    altrove,
    stay({
      arrivalDate: '2026-05-01',
      departureDate: '2026-05-04',
      guests: [adult, { birthDate: '1950-01-01' }],
    }),
    902,
    null,
  ],
  [
    '20. second comune: a senior and a child of 8 (241,2 → 241; 0)',
    altrove,
    stay({
      arrivalDate: '2026-05-01',
      departureDate: '2026-05-03',
      guests: [{ birthDate: '1950-01-01' }, { birthDate: '2018-01-01' }],
    }),
    241,
    null,
  ],
]

describe('the imposta, golden bookings (WP1.4)', () => {
  it.each(GOLDEN)('%s', (_name, rules, booking, total, issue) => {
    const tax = computeStayTax(rules, booking)
    expect(tax.totalCents).toBe(total)
    if (issue) expect(tax.issues.join(' | ')).toMatch(issue)
    else expect(tax.issues).toEqual([])
  })

  it('says why each night was not charged', () => {
    const tax = computeStayTax(
      esempio,
      stay({ arrivalDate: '2026-06-28', departureDate: '2026-07-06' }),
    )
    expect(
      tax.persons[0]!.nights.map((night) => [night.date.slice(5), night.status, night.code]),
    ).toEqual([
      ['06-28', 'taxable', null],
      ['06-29', 'taxable', null],
      ['06-30', 'taxable', null],
      ['07-01', 'taxable', null],
      ['07-02', 'taxable', null],
      ['07-03', 'exempt', 'max-nights'],
      ['07-04', 'exempt', 'max-nights'],
      ['07-05', 'exempt', 'max-nights'],
    ])
  })

  it('rounds half up, from hundredths of a cent', () => {
    expect([roundCentiCents(12050), roundCentiCents(12049), roundCentiCents(12060)]).toEqual([
      121, 120, 121,
    ])
  })
})

describe('the rules, as data', () => {
  it('ships only fictional comuni, each in the file named after its code', () => {
    const all = loadAllRules()
    expect(all.map((rules) => rules.comune)).toEqual(['999001', '999002'])
    expect(all.every((rules) => rules.fictional)).toBe(true)
  })

  it('refuses overlapping versions, and per-stay rounding split across periods', () => {
    const base = structuredClone(esempio)
    base.versions[0]!.effectiveTo = '2026-07-15'
    expect(() => parseRules(base)).toThrow(/overlap/)

    const split = structuredClone(altrove)
    split.versions[0]!.attribution = 'night'
    expect(() => parseRules(split)).toThrow(/per-stay rounding needs departure attribution/)
  })
})

describe('the June declaration, and its reconciliation', () => {
  const stays: TaxStay[] = [
    stay({
      reference: 'S2',
      arrivalDate: '2026-06-10',
      departureDate: '2026-06-12',
      guests: [adult, adult],
    }),
    stay({
      reference: 'S5',
      arrivalDate: '2026-06-01',
      departureDate: '2026-06-04',
      guests: [{ birthDate: '2011-03-01' }],
    }),
    stay({ reference: 'S8', arrivalDate: '2026-05-30', departureDate: '2026-06-02' }),
    stay({ reference: 'S9', arrivalDate: '2026-06-29', departureDate: '2026-07-02' }),
    stay({ reference: 'S10', arrivalDate: '2026-06-28', departureDate: '2026-07-06' }),
  ]
  const june = buildDeclaration(esempio, stays, { from: '2026-06-01', to: '2026-06-30' })

  it('attributes each night to its own month', () => {
    expect(june.lines.map((line) => [line.reference, line.amountCents])).toEqual([
      ['S2', 1200], // 2 × 2 × 3,00
      ['S5', 450], // 3 × 1,50, reduced
      ['S8', 300], // only 1 June is in June
      ['S9', 600], // 29 and 30 June
      ['S10', 900], // 28–30 June; July has the rest
    ])
    expect(june.totals).toEqual({
      persons: 6,
      taxableNights: 10,
      reducedNights: 3,
      exemptNights: {},
      amountCents: 3450,
    })

    const july = buildDeclaration(esempio, stays, { from: '2026-07-01', to: '2026-07-31' })
    expect(july.lines.find((line) => line.reference === 'S10')).toMatchObject({
      amountCents: 700, // 1 and 2 July at 3,50; three nights past the cap
      exemptNights: { 'max-nights': 3 },
    })
  })

  it('reconciles to the cent with what was collected, and names the stay that does not', () => {
    const collected = june.lines.map((line) => ({
      reference: line.reference,
      amountCents: line.amountCents,
    }))
    expect(reconcileDeclaration(june, collected)).toEqual({
      reconciles: true,
      declaredCents: 3450,
      collectedCents: 3450,
      differences: [],
    })

    const offByOne = collected.map((entry) =>
      entry.reference === 'S9' ? { ...entry, amountCents: 599 } : entry,
    )
    expect(
      reconcileDeclaration(june, [...offByOne, { reference: 'X1', amountCents: 200 }]),
    ).toEqual({
      reconciles: false,
      declaredCents: 3450,
      collectedCents: 3649,
      differences: [
        { reference: 'S9', declaredCents: 600, collectedCents: 599 },
        { reference: 'X1', declaredCents: 0, collectedCents: 200 },
      ],
    })
  })

  it('exports the declaration as a file', () => {
    expect(declarationCsv(june).split('\r\n')).toEqual([
      'prenotazione;persone;pernottamenti_imponibili;pernottamenti_ridotti;importo_euro',
      'S2;2;4;0;12,00',
      'S5;1;0;3;4,50',
      'S8;1;1;0;3,00',
      'S9;1;2;0;6,00',
      'S10;1;3;0;9,00',
      'TOTALE;6;10;3;34,50',
      '',
    ])
  })

  it('declares a whole stay in the month it leaves, for a comune that says so', () => {
    const senior = stay({
      reference: 'A1',
      arrivalDate: '2026-04-29',
      departureDate: '2026-05-02',
      guests: [{ birthDate: '1950-01-01' }],
    })
    // Three nights at 1,80 less 33%: 361,8 → 3,62, all in May.
    expect(
      buildDeclaration(altrove, [senior], { from: '2026-04-01', to: '2026-04-30' }).lines,
    ).toEqual([])
    expect(
      buildDeclaration(altrove, [senior], { from: '2026-05-01', to: '2026-05-31' }).totals
        .amountCents,
    ).toBe(362)
  })
})
