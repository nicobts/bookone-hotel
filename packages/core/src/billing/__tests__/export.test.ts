import { describe, expect, it } from 'vitest'
import { csvFilename, toCsv, type ExportLabels } from '../export'
import type { MonthlyReport } from '../report'

/**
 * The statement as a file (E5.4).
 *
 * An owner's next move with this is to open it in a spreadsheet beside their
 * own numbers, which is exactly the auditing the report invites. So the tests
 * are about the file surviving that: the right delimiter for the locale, the
 * right decimal handling, and a first line saying what the document is not.
 */

const labels: ExportLabels = {
  disclaimer: 'Working statement. Not an invoice and not a fiscal document.',
  headers: {
    section: 'Type',
    reference: 'Reference',
    guest: 'Guest',
    arrival: 'Arrival',
    departure: 'Departure',
    basis: 'Stay total',
    rate: 'Rate',
    fee: 'Fee',
    credit: 'Credit',
    net: 'Net',
    evidence: 'Attribution reason',
  },
  sections: { subscription: 'Platform', direct_booking: 'Direct', ai_attributed: 'AI' },
  total: 'Total',
  perRoom: 'Per room',
}

const report: MonthlyReport = {
  propertyId: 'p1',
  propertyName: 'Hôtel Sønja & Co',
  periodStart: '2026-08-01',
  periodEnd: '2026-09-01',
  currency: 'EUR',
  status: 'draft',
  issuedAt: null,
  totalCents: 35_440,
  perRoomCents: 1_969,
  rooms: 18,
  hasOpenDisputes: false,
  sections: [
    {
      kind: 'subscription',
      count: 0,
      basisCents: null,
      rateBps: null,
      grossCents: 25_000,
      creditCents: 0,
      netCents: 25_000,
      items: [],
    },
    {
      kind: 'direct_booking',
      count: 1,
      basisCents: 36_000,
      rateBps: 300,
      grossCents: 1_080,
      creditCents: 0,
      netCents: 1_080,
      items: [
        {
          feeEventId: 'f1',
          reservationId: 'r1',
          reference: 'BO-AAA111',
          guestName: 'Weber, Rosa',
          arrivalDate: '2026-09-18',
          departureDate: '2026-09-20',
          basisCents: 36_000,
          rateBps: 300,
          feeCents: 1_080,
          evidence: {},
          disputedAt: null,
          creditCents: 0,
        },
      ],
    },
    {
      kind: 'ai_attributed',
      count: 1,
      basisCents: 36_000,
      rateBps: 1_000,
      grossCents: 3_600,
      creditCents: 3_600,
      netCents: 0,
      items: [
        {
          feeEventId: 'f2',
          reservationId: 'r2',
          reference: 'BO-BBB222',
          guestName: 'Huber',
          arrivalDate: '2026-09-18',
          departureDate: '2026-09-20',
          basisCents: 36_000,
          rateBps: 1_000,
          feeCents: 3_600,
          evidence: { reason: 'concierge session with no engine session before it' },
          disputedAt: '2026-08-29T09:00:00.000Z',
          creditCents: 3_600,
        },
      ],
    },
  ],
}

const csv = () => toCsv(report, labels)

describe('toCsv', () => {
  it('says what the document is not, on the first line', () => {
    // It ends up with a commercialista. A file of amounts with no such line
    // invites exactly the wrong assumption (D11, binding rule 6).
    expect(csv().split('\r\n')[0]).toContain('Not an invoice')
  })

  it('is semicolon-delimited', () => {
    /*
     * The target market is IT/AT/SI, where Excel's list separator follows a
     * locale that uses the comma as a decimal mark. A comma-delimited file
     * opens as one column per row for exactly the people this is for, and
     * "change your regional settings" is not an answer to give an owner about
     * their invoice.
     */
    const header = csv().split('\r\n')[2]

    expect(header).toBe(
      'Type;Reference;Guest;Arrival;Departure;Stay total;Rate;Fee;Credit;Net;Attribution reason',
    )
  })

  it('quotes a value containing the delimiter', () => {
    // "Weber, Rosa" is a comma, which is harmless here — but a guest name with
    // a semicolon in it would break the row, and the escape is what stops the
    // rest of the file shifting one column left.
    const quoted = toCsv(
      {
        ...report,
        sections: report.sections.map((section) =>
          section.kind === 'direct_booking'
            ? {
                ...section,
                items: section.items.map((item) => ({ ...item, guestName: 'Weber; Rosa' })),
              }
            : section,
        ),
      },
      labels,
    )

    expect(quoted).toContain('"Weber; Rosa"')
  })

  it('writes money as a decimal from integer cents', () => {
    // Never a float. The same rule the schema keeps everywhere else, and the
    // one place it would land in a number somebody is billed from.
    expect(csv()).toContain('360.00')
    expect(csv()).toContain('10.80')
    expect(csv()).toContain('250.00')
  })

  it('carries the credit and the net separately', () => {
    // An owner needs to see both what was charged and what came off. A file
    // showing only the net makes a dispute invisible in the record of it.
    const line = csv()
      .split('\r\n')
      .find((row) => row.startsWith('AI;'))

    expect(line).toContain('36.00;36.00;0.00')
  })

  it('carries the attribution reason for an attributed line and nothing for a direct one', () => {
    const rows = csv().split('\r\n')

    expect(rows.find((row) => row.startsWith('AI;'))).toContain('no engine session before it')
    expect(rows.find((row) => row.startsWith('Direct;'))?.endsWith(';')).toBe(true)
  })

  it('ends with the total and the per-room equivalence', () => {
    const rows = csv().split('\r\n')

    expect(rows.at(-2)).toContain('354.40')
    expect(rows.at(-1)).toContain('19.69')
  })

  it('omits the per-room line when there is no room count', () => {
    // Null rather than a guess. See the field comment: a number derived from
    // room *types* would be wrong and look authoritative.
    const rows = toCsv({ ...report, perRoomCents: null, rooms: null }, labels).split('\r\n')

    expect(rows.at(-1)).toContain('354.40')
  })

  it('uses CRLF, because the spreadsheets this is for are fussy about it', () => {
    expect(csv()).toContain('\r\n')
  })
})

describe('csvFilename', () => {
  it('is a stable, sortable, accent-free name', () => {
    // Property first so a folder of them groups; accents stripped because a
    // filename crossing an email, a Mac and a Windows box should not need to
    // survive three different normalisations.
    expect(csvFilename(report)).toBe('hotel-sonja-co-2026-08.csv')
  })

  it('handles the letters NFD does not decompose', () => {
    /*
     * Found by this suite: the fixture is named "Hôtel Sønja & Co" and produced
     * `hotel-s-nja-co`. Stripping combining marks covers ä, ö, ü, č, š, ž — and
     * misses ß and ø, which are separate letters rather than a base plus a mark.
     * ß matters in this market.
     */
    expect(csvFilename({ ...report, propertyName: 'Gasthof Weiß' })).toBe(
      'gasthof-weiss-2026-08.csv',
    )
    expect(csvFilename({ ...report, propertyName: 'Penzion Držić' })).toBe(
      'penzion-drzic-2026-08.csv',
    )
  })

  it('falls back rather than producing a leading dash', () => {
    expect(csvFilename({ ...report, propertyName: '???' })).toBe('property-2026-08.csv')
  })
})
