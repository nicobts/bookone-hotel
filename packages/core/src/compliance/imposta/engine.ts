import { seasonOn, versionOn, type ComuneRules, type RuleVersion } from './rules'

/**
 * The imposta di soggiorno for one stay, night by night and person by person
 * (WP1.4). Pure: the comune's rules and the stay in, every night's charge and
 * the reason for it out, so a declaration, a guest's receipt and an audit all
 * read the same answer.
 *
 * Amounts are integers throughout: cents, and hundredths of a cent while a
 * reduction is applied, rounded half up where the rules say (per night, or
 * once per person's stay). No floating point touches money.
 */

export interface TaxGuest {
  /** `YYYY-MM-DD`; age-based exemptions and reductions need it. */
  birthDate?: string | null
  /** A reason exemption's code from the rules, with its evidence kept elsewhere. */
  exemption?: string | null
}

export interface TaxStay {
  reference: string
  arrivalDate: string
  departureDate: string
  /** The property's category as the comune's rates name it (`hotel-3`, `b&b`). */
  category: string
  /** The party size; guests beyond `guests` are charged as adults without exemption. */
  partySize: number
  guests: readonly TaxGuest[]
}

export type NightStatus = 'taxable' | 'reduced' | 'exempt'

export interface TaxNight {
  date: string
  status: NightStatus
  /** The exemption or reduction that applied, or `max-nights` past the cap. */
  code: string | null
  /** The night's charge in hundredths of a cent, before rounding. */
  centiCents: number
  /** Rounded to the cent under `per-night` rounding; null under `per-stay`. */
  amountCents: number | null
}

export interface PersonTax {
  guestIndex: number
  /** False for a guest counted from the party size without a record. */
  recorded: boolean
  nights: TaxNight[]
  amountCents: number
}

export interface StayTax {
  reference: string
  departureDate: string
  currency: 'EUR'
  rounding: RuleVersion['rounding']
  attribution: RuleVersion['attribution']
  persons: PersonTax[]
  totalCents: number
  /** Problems a person must look at; a stay with issues is not declared as is. */
  issues: string[]
}

/** Half up, from hundredths of a cent to cents. */
export function roundCentiCents(centiCents: number): number {
  return Math.floor((centiCents + 50) / 100)
}

export function ageOn(birthDate: string, date: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

function nightsOf(arrival: string, departure: string): string[] {
  const nights: string[] = []
  for (let night = arrival; night < departure;) {
    nights.push(night)
    const next = new Date(`${night}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    night = next.toISOString().slice(0, 10)
  }
  return nights
}

export function computeStayTax(rules: ComuneRules, stay: TaxStay): StayTax {
  const issues: string[] = []
  const nights = nightsOf(stay.arrivalDate, stay.departureDate)
  const atArrival = versionOn(rules, stay.arrivalDate)
  if (!atArrival) issues.push(`no rules in force on ${stay.arrivalDate}`)
  // Taken from the version in force at arrival: a stay does not gain or lose
  // free nights because a deliberation took effect halfway through it.
  const maxNights = atArrival?.maxNights ?? null
  const rounding = atArrival?.rounding ?? 'per-night'
  const attribution = atArrival?.attribution ?? 'night'

  const size = Math.max(stay.partySize, stay.guests.length, 1)
  if (size > stay.guests.length) {
    issues.push(`${size - stay.guests.length} of ${size} guests not recorded: charged as adults`)
  }

  const persons: PersonTax[] = []
  for (let guestIndex = 0; guestIndex < size; guestIndex += 1) {
    const guest = stay.guests[guestIndex]
    const age = guest?.birthDate ? ageOn(guest.birthDate, stay.arrivalDate) : null
    // A recorded guest with no birth date is charged as an adult. Say so when
    // any version during the stay has an age rule, rather than guess.
    if (guest && age === null) {
      const ageRules = nights.some((date) => {
        const version = versionOn(rules, date)
        return (
          version !== null &&
          (version.exemptions.some((exemption) => exemption.kind === 'age') ||
            version.reductions.length > 0)
        )
      })
      if (ageRules) {
        issues.push(`guest ${guestIndex + 1}: no birth date; charged as an adult`)
      }
    }

    const taxNights = nights.map((date, index): TaxNight => {
      const exempt = (code: string): TaxNight => ({
        date,
        status: 'exempt',
        code,
        centiCents: 0,
        amountCents: rounding === 'per-night' ? 0 : null,
      })

      if (maxNights !== null && index >= maxNights) return exempt('max-nights')

      const version = versionOn(rules, date)
      if (!version) {
        issues.push(`no rules in force on ${date}`)
        return exempt('no-rules')
      }

      if (guest?.exemption) {
        const declared = version.exemptions.find(
          (exemption) => exemption.kind === 'reason' && exemption.code === guest.exemption,
        )
        if (declared) return exempt(declared.code)
        issues.push(
          `guest ${guestIndex + 1}: "${guest.exemption}" is not an exemption in these rules`,
        )
      }

      if (age !== null) {
        const byAge = version.exemptions.find(
          (exemption) => exemption.kind === 'age' && age < exemption.underAge,
        )
        if (byAge) return exempt(byAge.code)
      }

      const season = seasonOn(version, date)
      const rate =
        version.rates.find((r) => r.season === season && r.category === stay.category) ??
        version.rates.find((r) => r.season === season && r.category === '*')
      if (!rate) {
        issues.push(
          `no rate for category "${stay.category}" in season "${season ?? '—'}" on ${date}`,
        )
        return exempt('no-rate')
      }

      const reduction =
        age === null
          ? undefined
          : version.reductions.find(
              (r) => age >= r.fromAge && (r.underAge === undefined || age < r.underAge),
            )
      const centiCents = rate.amountCents * (reduction ? 100 - reduction.percent : 100)
      return {
        date,
        status: reduction ? 'reduced' : 'taxable',
        code: reduction?.code ?? null,
        centiCents,
        amountCents: rounding === 'per-night' ? roundCentiCents(centiCents) : null,
      }
    })

    const amountCents =
      rounding === 'per-night'
        ? taxNights.reduce((sum, night) => sum + (night.amountCents ?? 0), 0)
        : roundCentiCents(taxNights.reduce((sum, night) => sum + night.centiCents, 0))

    persons.push({
      guestIndex,
      recorded: guestIndex < stay.guests.length,
      nights: taxNights,
      amountCents,
    })
  }

  return {
    reference: stay.reference,
    departureDate: stay.departureDate,
    currency: 'EUR',
    rounding,
    attribution,
    persons,
    totalCents: persons.reduce((sum, person) => sum + person.amountCents, 0),
    issues: [...new Set(issues)],
  }
}
