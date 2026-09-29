/**
 * The daily tourist-movement series (ISTAT C/59, WP1.3): for each day, how many
 * guests arrived, left and stayed the night, by where they come from, and how
 * many rooms were occupied.
 *
 * Pure: stays in, a series out. The same function builds what is filed, the
 * fallback file, and the comparison with what the portal shows, so the three
 * cannot disagree.
 *
 * ## The counts, as ISTAT defines them
 *
 * - **Arrivals** on day d: guests whose stay starts on d.
 * - **Departures** on day d: guests whose stay ends on d.
 * - **Presences** on day d: guests who spend the night of d, so a stay from d
 *   to d+3 is three presences, on d, d+1 and d+2. Nights, not days.
 * - **Rooms occupied** on day d: stays spending the night of d.
 *
 * **Every day is in the series, including days with nobody.** A structure
 * reports zero-presence days too (plan §5: "daily incl. zero days"); a gap in
 * the series is a missing return, not a quiet day.
 *
 * ## Origin
 *
 * ISTAT counts by **residence**: the country for foreign residents, the
 * province for Italian residents. The pre-arrival form does not ask for
 * residence yet, so a guest's origin is their recorded residence when there is
 * one and otherwise their citizenship, and each day says how many guests were
 * counted by citizenship (`byCitizenship`). A guest with neither is `unknown`,
 * and a day with an unknown guest is not ready to file: the desk is told whose
 * record is missing, as for Alloggiati.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  VERIFY BEFORE PRODUCTION: the residence-versus-citizenship question and the
 *  origin coding (ISO country; `IT-` and the province) are ours. WebTur's own
 *  coding comes with the Regione's specification (WP1.3 is blocked on it).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface MovementGuest {
  /** ISO 3166-1 alpha-2 of the country of residence, when recorded. */
  residenceCountry?: string | null
  /** Two-letter Italian province of residence, when recorded. */
  residenceProvince?: string | null
  /** ISO alpha-2 citizenship: the fallback origin. */
  citizenship?: string | null
}

export interface MovementStay {
  /** For the desk's message when a guest's origin is missing. */
  reference: string
  arrivalDate: string
  departureDate: string
  /** The party size. May exceed `guests` when not everyone was recorded. */
  partySize: number
  /** The guests with a record, in order. */
  guests: readonly MovementGuest[]
}

export interface OriginCounts {
  arrivals: number
  departures: number
  presences: number
}

export interface DayMovement {
  day: string
  /** By origin: `FR`, `IT-TS`, `IT` (Italian, province unknown), `unknown`. */
  byOrigin: Record<string, OriginCounts>
  totals: OriginCounts
  roomsOccupied: number
  /** Guests counted by citizenship because no residence was recorded. */
  byCitizenship: number
  /** Stays with a guest whose origin is unknown, by reference. */
  unknownIn: string[]
}

export function originOf(guest: MovementGuest | undefined): {
  origin: string
  byCitizenship: boolean
} {
  const country = guest?.residenceCountry?.trim().toUpperCase()
  if (country) {
    const province = guest?.residenceProvince?.trim().toUpperCase()
    return {
      origin: country === 'IT' && province ? `IT-${province}` : country,
      byCitizenship: false,
    }
  }
  const citizenship = guest?.citizenship?.trim().toUpperCase()
  if (citizenship) return { origin: citizenship, byCitizenship: true }
  return { origin: 'unknown', byCitizenship: false }
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

/** The series for every day from `from` to `to`, both included. */
export function dailyMovement(
  stays: readonly MovementStay[],
  from: string,
  to: string,
): DayMovement[] {
  const series = new Map<string, DayMovement>(
    daysBetween(from, to).map((day) => [
      day,
      {
        day,
        byOrigin: {},
        totals: { arrivals: 0, departures: 0, presences: 0 },
        roomsOccupied: 0,
        byCitizenship: 0,
        unknownIn: [],
      },
    ]),
  )

  const add = (day: string, origin: string, field: keyof OriginCounts) => {
    const entry = series.get(day)
    if (!entry) return
    entry.byOrigin[origin] ??= { arrivals: 0, departures: 0, presences: 0 }
    entry.byOrigin[origin]![field] += 1
    entry.totals[field] += 1
  }

  for (const stay of stays) {
    if (stay.departureDate <= stay.arrivalDate) continue
    const size = Math.max(stay.partySize, stay.guests.length, 1)
    const nights: string[] = []
    for (let night = stay.arrivalDate; night < stay.departureDate; night = addDays(night, 1)) {
      nights.push(night)
    }

    for (let index = 0; index < size; index += 1) {
      const { origin, byCitizenship } = originOf(stay.guests[index])
      add(stay.arrivalDate, origin, 'arrivals')
      add(stay.departureDate, origin, 'departures')
      for (const night of nights) {
        add(night, origin, 'presences')
        const entry = series.get(night)
        if (byCitizenship && entry) entry.byCitizenship += 1
      }
      if (origin === 'unknown') {
        for (const day of [stay.arrivalDate, ...nights, stay.departureDate]) {
          const entry = series.get(day)
          if (entry && !entry.unknownIn.includes(stay.reference))
            entry.unknownIn.push(stay.reference)
        }
      }
    }

    for (const night of nights) {
      const entry = series.get(night)
      if (entry) entry.roomsOccupied += 1
    }
  }

  return [...series.values()]
}
