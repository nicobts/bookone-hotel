import { computeStayTax, type NightStatus, type StayTax, type TaxStay } from './engine'
import type { ComuneRules } from './rules'
import { csvCell } from '../csv'

/**
 * The period declaration and its reconciliation (WP1.4).
 *
 * A declaration is the sum of each stay's tax attributed to the period, per
 * the comune's rule: each night to its own period, or the whole stay to the
 * period of its departure. Reconciliation compares it, stay by stay and to the
 * cent, with what the property actually collected. A declaration that does
 * not reconcile is a declaration nobody should sign.
 *
 * The export's layout is ours: the comune's declaration format is part of what
 * WP1.4 is blocked on. VERIFY it against the comune's own model.
 */

export interface DeclarationLine {
  reference: string
  /** People with at least one night in the period. */
  persons: number
  taxableNights: number
  reducedNights: number
  /** Nights not charged, by exemption code (`max-nights` included). */
  exemptNights: Record<string, number>
  amountCents: number
}

export interface Declaration {
  comune: string
  from: string
  to: string
  lines: DeclarationLine[]
  totals: Omit<DeclarationLine, 'reference'>
  /** Stays with a problem, which must be resolved before the period is declared. */
  issues: { reference: string; issue: string }[]
}

function inPeriod(date: string, from: string, to: string): boolean {
  return from <= date && date <= to
}

function lineFor(tax: StayTax, from: string, to: string): DeclarationLine | null {
  const whole = tax.attribution === 'departure'
  if (whole && !inPeriod(tax.departureDate, from, to)) return null

  const line: DeclarationLine = {
    reference: tax.reference,
    persons: 0,
    taxableNights: 0,
    reducedNights: 0,
    exemptNights: {},
    amountCents: 0,
  }
  for (const person of tax.persons) {
    const nights = whole ? person.nights : person.nights.filter((n) => inPeriod(n.date, from, to))
    if (nights.length === 0) continue
    line.persons += 1
    for (const night of nights) {
      const count: Record<NightStatus, () => void> = {
        taxable: () => (line.taxableNights += 1),
        reduced: () => (line.reducedNights += 1),
        exempt: () => {
          const code = night.code ?? 'exempt'
          line.exemptNights[code] = (line.exemptNights[code] ?? 0) + 1
        },
      }
      count[night.status]()
    }
    line.amountCents += whole
      ? person.amountCents
      : nights.reduce((sum, night) => sum + (night.amountCents ?? 0), 0)
  }
  return line.persons > 0 ? line : null
}

export function buildDeclaration(
  rules: ComuneRules,
  stays: readonly TaxStay[],
  period: { from: string; to: string },
): Declaration {
  const lines: DeclarationLine[] = []
  const issues: Declaration['issues'] = []

  for (const stay of stays) {
    const tax = computeStayTax(rules, stay)
    const line = lineFor(tax, period.from, period.to)
    if (!line) continue
    lines.push(line)
    for (const issue of tax.issues) issues.push({ reference: stay.reference, issue })
  }

  const totals: Declaration['totals'] = {
    persons: 0,
    taxableNights: 0,
    reducedNights: 0,
    exemptNights: {},
    amountCents: 0,
  }
  for (const line of lines) {
    totals.persons += line.persons
    totals.taxableNights += line.taxableNights
    totals.reducedNights += line.reducedNights
    totals.amountCents += line.amountCents
    for (const [code, count] of Object.entries(line.exemptNights)) {
      totals.exemptNights[code] = (totals.exemptNights[code] ?? 0) + count
    }
  }

  return { comune: rules.comune, from: period.from, to: period.to, lines, totals, issues }
}

/** Cents as the comune's forms write them: `1234,56`. */
function euros(cents: number): string {
  return `${Math.trunc(cents / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`
}

/** The declaration as semicolon CSV: one line per stay, then the totals. */
export function declarationCsv(declaration: Declaration): string {
  const codes = Object.keys(declaration.totals.exemptNights).sort()
  const header = [
    'prenotazione',
    'persone',
    'pernottamenti_imponibili',
    'pernottamenti_ridotti',
    ...codes.map((code) => `esenti_${code}`),
    'importo_euro',
  ]
  const row = (reference: string, line: Omit<DeclarationLine, 'reference'>) =>
    [
      // Escaped: a reference is data, and must neither run as a formula nor
      // break the columns in the comune's spreadsheet.
      csvCell(reference),
      line.persons,
      line.taxableNights,
      line.reducedNights,
      ...codes.map((code) => line.exemptNights[code] ?? 0),
      euros(line.amountCents),
    ].join(';')
  return (
    [
      header.join(';'),
      ...declaration.lines.map((line) => row(line.reference, line)),
      row('TOTALE', declaration.totals),
    ].join('\r\n') + '\r\n'
  )
}

export interface Reconciliation {
  reconciles: boolean
  declaredCents: number
  collectedCents: number
  /** Every stay where what was declared and what was collected differ. */
  differences: { reference: string; declaredCents: number; collectedCents: number }[]
}

/**
 * The declaration against what the property collected, stay by stay. A stay
 * collected but not declared, or declared but not collected, is a difference
 * too.
 */
export function reconcileDeclaration(
  declaration: Declaration,
  collected: readonly { reference: string; amountCents: number }[],
): Reconciliation {
  const declared = new Map(declaration.lines.map((line) => [line.reference, line.amountCents]))
  const received = new Map<string, number>()
  for (const entry of collected) {
    received.set(entry.reference, (received.get(entry.reference) ?? 0) + entry.amountCents)
  }

  const differences: Reconciliation['differences'] = []
  for (const reference of [...new Set([...declared.keys(), ...received.keys()])].sort()) {
    const d = declared.get(reference) ?? 0
    const c = received.get(reference) ?? 0
    if (d !== c) differences.push({ reference, declaredCents: d, collectedCents: c })
  }

  const collectedCents = [...received.values()].reduce((sum, value) => sum + value, 0)
  return {
    reconciles: differences.length === 0,
    declaredCents: declaration.totals.amountCents,
    collectedCents,
    differences,
  }
}
