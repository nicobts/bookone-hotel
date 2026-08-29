import type { MonthlyReport } from './report'

/**
 * The report as a file (E5.4: export PDF/CSV).
 *
 * ## Why CSV here and no PDF
 *
 * CSV is generated in core because it is data, and a hotelier's next move with
 * this file is to open it in a spreadsheet beside their own numbers — which is
 * exactly the auditing the report is designed to invite.
 *
 * The "PDF" the acceptance criterion asks for is the browser's own print of the
 * report page, styled for print. That is a deliberate choice rather than a
 * shortcut: adding a PDF library to render a second, parallel version of the
 * statement means two renderers that can disagree, and the one nobody looks at
 * is the one that gets sent. Printing the page guarantees the document says
 * what the screen said.
 *
 * ## What the file says about itself
 *
 * A file with amounts on it, emailed to a hotelier in Italy, ends up with a
 * commercialista. So the first line says what it is and is not: a working
 * statement, not a fiscal document (D11, binding rule 6). Cheap to write,
 * expensive to leave out.
 */

/** RFC 4180: quote when the value could otherwise break the row. */
function cell(value: string | number | null): string {
  if (value === null) return ''

  const text = String(value)

  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Cents as a decimal string. Never a float — see the money rule in the schema. */
function amount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)

  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

export interface ExportLabels {
  disclaimer: string
  headers: {
    section: string
    reference: string
    guest: string
    arrival: string
    departure: string
    basis: string
    rate: string
    fee: string
    credit: string
    net: string
    evidence: string
  }
  sections: { subscription: string; direct_booking: string; ai_attributed: string }
  total: string
  perRoom: string
}

/**
 * One row per fee, plus the subscription and the total.
 *
 * Semicolon-delimited: the target market is Italy, Austria and Slovenia, where
 * Excel's default list separator follows a locale that uses the comma as a
 * decimal mark. A comma-delimited file opens as one column per row for exactly
 * the people this is for, and "change your regional settings" is not an answer
 * anybody should have to give an owner about their invoice.
 */
export function toCsv(report: MonthlyReport, labels: ExportLabels): string {
  const rows: string[] = []

  rows.push(cell(labels.disclaimer))
  rows.push('')
  rows.push(
    [
      labels.headers.section,
      labels.headers.reference,
      labels.headers.guest,
      labels.headers.arrival,
      labels.headers.departure,
      labels.headers.basis,
      labels.headers.rate,
      labels.headers.fee,
      labels.headers.credit,
      labels.headers.net,
      labels.headers.evidence,
    ]
      .map(cell)
      .join(';'),
  )

  for (const section of report.sections) {
    if (section.kind === 'subscription') {
      rows.push(
        [
          labels.sections.subscription,
          '',
          '',
          '',
          '',
          '',
          '',
          amount(section.grossCents),
          amount(section.creditCents),
          amount(section.netCents),
          '',
        ]
          .map(cell)
          .join(';'),
      )
      continue
    }

    for (const item of section.items) {
      rows.push(
        [
          labels.sections[section.kind],
          item.reference,
          item.guestName ?? '',
          item.arrivalDate,
          item.departureDate,
          amount(item.basisCents),
          `${(item.rateBps / 100).toFixed(2)}%`,
          amount(item.feeCents),
          amount(item.creditCents),
          amount(item.feeCents - item.creditCents),
          /*
           * The evidence, inline, as the reason string.
           *
           * Not the whole JSON chain: a cell containing a serialised object is
           * a cell nobody reads, and the drill-down on screen is where the full
           * chain lives. What belongs here is the sentence that says *why* this
           * booking was billed at this rate.
           */
          section.kind === 'ai_attributed' ? String(item.evidence.reason ?? '') : '',
        ]
          .map(cell)
          .join(';'),
      )
    }
  }

  rows.push('')
  rows.push(
    [labels.total, '', '', '', '', '', '', '', '', amount(report.totalCents), '']
      .map(cell)
      .join(';'),
  )

  if (report.perRoomCents !== null) {
    rows.push(
      [labels.perRoom, '', '', '', '', '', '', '', '', amount(report.perRoomCents), '']
        .map(cell)
        .join(';'),
    )
  }

  // CRLF, because the same spreadsheets this is written for are the ones that
  // are fussiest about it.
  return rows.join('\r\n')
}

/**
 * Letters NFD does not decompose.
 *
 * Stripping combining marks handles ä, ö, ü, á, č, š, ž — every accent this
 * market's names actually carry — but not these, which are separate letters in
 * Unicode rather than a base plus a mark. Without the map, "Gasthof Weiß"
 * becomes `gasthof-wei-` and "Hotel Sønja" becomes `hotel-s-nja`.
 *
 * Short and explicit rather than a transliteration dependency: five entries
 * covers the German and Nordic cases a property name in IT/AT/SI plausibly has,
 * and a package for this would be a package to keep for a filename.
 */
const UNDECOMPOSABLE: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  đ: 'd',
  ł: 'l',
}

/** A stable, sortable filename. Property first, so a folder of them groups. */
export function csvFilename(report: MonthlyReport): string {
  const slug = report.propertyName
    .toLowerCase()
    .replace(/[ßøæđł]/g, (letter) => UNDECOMPOSABLE[letter] ?? letter)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return `${slug || 'property'}-${report.periodStart.slice(0, 7)}.csv`
}
