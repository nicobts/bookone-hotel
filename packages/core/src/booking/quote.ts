import { z } from 'zod'

/**
 * Pricing a stay (E1.1, E1.2).
 *
 * Pure, and deliberately so: this is the arithmetic a guest is charged on, and
 * it deserves tests that do not need a database, a connector or a browser.
 * Nothing here reads or writes anything — callers hand it snapshot rows and get
 * a quote back.
 *
 * Every amount is integer cents (binding rule: money is never a float). The
 * quote also carries the ids of the snapshots it was computed from, because
 * PRD A2 requires a shown price to be traceable to the fetch that produced it,
 * and a total with no provenance is unanswerable when it is disputed.
 */

/** One night's price as a source stated it. */
export interface SnapshotNight {
  /** The night itself, `YYYY-MM-DD`. The night of the 3rd is [3rd, 4th). */
  date: string
  priceCents: number
  currency: string
  snapshotId: string
}

export interface StayQuote {
  nights: { date: string; priceCents: number }[]
  nightCount: number
  totalCents: number
  currency: string
  /** Provenance, in the order the nights were priced (PRD A2). */
  snapshotIds: string[]
}

export type QuoteFailure =
  /** Departure is not after arrival. Not a pricing problem; a bad request. */
  | { reason: 'no-nights' }
  /**
   * A night the source never priced.
   *
   * The surface must not fill the gap — a stay priced on four of five nights is
   * cheaper than the stay actually is, and the guest would be right to hold us
   * to the number we showed.
   */
  | { reason: 'missing-night'; date: string }
  /**
   * Two currencies inside one stay. Impossible from a single source, which is
   * exactly why it is worth failing on: it means the snapshots came from two,
   * and adding them together would produce a number in no currency at all.
   */
  | { reason: 'mixed-currency'; currencies: string[] }

export type QuoteResult = { ok: true; quote: StayQuote } | { ok: false; failure: QuoteFailure }

/**
 * The nights a stay actually occupies.
 *
 * Departure is exclusive everywhere in this codebase: arriving on the 3rd and
 * leaving on the 5th is two nights, the 3rd and the 4th. Stated once, here, so
 * no caller has to decide it again.
 */
export function nightsBetween(arrival: string, departure: string): string[] {
  const start = Date.parse(`${arrival}T00:00:00Z`)
  const end = Date.parse(`${departure}T00:00:00Z`)

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return []

  const nights: string[] = []
  for (let t = start; t < end; t += 86_400_000) {
    nights.push(new Date(t).toISOString().slice(0, 10))
  }

  return nights
}

export function quoteStay(
  arrival: string,
  departure: string,
  snapshots: readonly SnapshotNight[],
): QuoteResult {
  const nights = nightsBetween(arrival, departure)
  if (nights.length === 0) return { ok: false, failure: { reason: 'no-nights' } }

  // Last one wins on a duplicate date. The refresh replaces its window rather
  // than accumulating, so duplicates should not exist — but if two sources ever
  // both price a night, taking one deterministically beats summing both.
  const byDate = new Map(snapshots.map((snapshot) => [snapshot.date, snapshot]))

  const priced: SnapshotNight[] = []

  for (const night of nights) {
    const snapshot = byDate.get(night)
    if (!snapshot) return { ok: false, failure: { reason: 'missing-night', date: night } }

    priced.push(snapshot)
  }

  const currencies = [...new Set(priced.map((night) => night.currency))]
  if (currencies.length > 1) {
    return { ok: false, failure: { reason: 'mixed-currency', currencies } }
  }

  const currency = currencies[0] ?? 'EUR'

  return {
    ok: true,
    quote: {
      nights: priced.map((night) => ({ date: night.date, priceCents: night.priceCents })),
      nightCount: priced.length,
      totalCents: priced.reduce((sum, night) => sum + night.priceCents, 0),
      currency,
      snapshotIds: priced.map((night) => night.snapshotId),
    },
  }
}

// ---------------------------------------------------------------------------
// Tourist tax
// ---------------------------------------------------------------------------

/**
 * The *imposta di soggiorno* and its Austrian and Slovenian equivalents.
 *
 * A **note**, never a line in the total — see docs/design-notes/booking-flow.md
 * §4D. In all three markets the property generally collects it at the point of
 * stay, so adding it to what the guest pays online would misstate the charge,
 * and omitting it produces a surprise at the desk.
 *
 * Configured per property because the rate, the cap and the exemption age are
 * all set by the comune or municipality, not by us.
 */
export const touristTaxPolicySchema = z.object({
  amountCentsPerPersonPerNight: z.number().int().nonnegative(),
  currency: z.string().default('EUR'),
  /** Nights beyond this are free. Common in Italy — often 3 to 7. */
  maxNights: z.number().int().positive().optional(),
  /** Children below this age pay nothing. */
  exemptUnderAge: z.number().int().positive().optional(),
})

export type TouristTaxPolicy = z.infer<typeof touristTaxPolicySchema>

/** The shape the policy lives in, inside `properties.settings`. */
export const propertySettingsSchema = z.object({
  touristTax: touristTaxPolicySchema.optional(),
})

export interface TouristTaxNote {
  perPersonPerNightCents: number
  currency: string
  /** Nights actually charged, after the cap. */
  chargeableNights: number
  /** People the estimate covers. See `childrenExcluded`. */
  chargeablePeople: number
  estimateCents: number
  /** The cap that applied, or null if none did. */
  cappedAtNights: number | null
  exemptUnderAge: number | null
  /**
   * True when children were left out of the estimate because the property
   * exempts them below an age we never asked for.
   *
   * We collect a child *count*, not birthdates — the booking step that asked
   * for ages would be a step that loses bookings, and the property checks
   * documents at arrival anyway. So the estimate covers adults, the exemption
   * age is stated, and the copy says the rest. Silently charging for children
   * at the adult rate would overstate the note; silently exempting them would
   * understate it. Neither is a guess we are entitled to make.
   */
  childrenExcluded: boolean
}

export function touristTaxNote(
  policy: TouristTaxPolicy,
  stay: { nightCount: number; adults: number; children: number },
): TouristTaxNote {
  const capped = policy.maxNights !== undefined && stay.nightCount > policy.maxNights
  const chargeableNights = capped ? (policy.maxNights ?? stay.nightCount) : stay.nightCount

  const childrenExcluded = policy.exemptUnderAge !== undefined && stay.children > 0
  const chargeablePeople = childrenExcluded ? stay.adults : stay.adults + stay.children

  return {
    perPersonPerNightCents: policy.amountCentsPerPersonPerNight,
    currency: policy.currency,
    chargeableNights,
    chargeablePeople,
    estimateCents: policy.amountCentsPerPersonPerNight * chargeableNights * chargeablePeople,
    cappedAtNights: capped ? (policy.maxNights ?? null) : null,
    exemptUnderAge: policy.exemptUnderAge ?? null,
    childrenExcluded,
  }
}

/** Reads the policy out of `properties.settings`, tolerating anything. */
export function readTouristTaxPolicy(settings: unknown): TouristTaxPolicy | null {
  const parsed = propertySettingsSchema.safeParse(settings)
  if (!parsed.success) return null

  return parsed.data.touristTax ?? null
}
