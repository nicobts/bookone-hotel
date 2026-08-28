import { z } from 'zod'

/**
 * Deposit and cancellation policy (PRD A4/A5, 03 §7).
 *
 * Pure and provider-agnostic, which is the point of ADR-010: when the Italian
 * provider swap happens, a new `PaymentAdapter` is written and **nothing in
 * this file changes**. It computes money from a property's own rules and a
 * clock; it has never heard of Stripe.
 *
 * Every amount is integer cents. Every date is a hotel-local calendar date
 * resolved in the property's timezone, because "48 hours before arrival" means
 * 48 hours before the hotel's day starts, not before some instant in UTC — and
 * a guest cancelling at the deadline is entitled to the answer the hotel would
 * give at the desk.
 */

/** What the guest pays now, if anything. */
export const depositPolicySchema = z.discriminatedUnion('mode', [
  /** Nothing online; the property arranges payment itself. */
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('percent'), percent: z.number().min(1).max(100) }),
  z.object({ mode: z.literal('first_night') }),
  z.object({ mode: z.literal('full') }),
])

export type DepositPolicy = z.infer<typeof depositPolicySchema>

/**
 * One cancellation window.
 *
 * Read as "cancel at least this many hours before arrival and this much comes
 * back". Windows are sorted and applied largest-first, so the order they were
 * typed in settings cannot change what a guest is refunded.
 */
export const cancellationWindowSchema = z.object({
  hoursBeforeArrival: z.number().int().nonnegative(),
  refundPercent: z.number().min(0).max(100),
})

export type CancellationWindow = z.infer<typeof cancellationWindowSchema>

export const bookingPolicySchema = z.object({
  deposit: depositPolicySchema.default({ mode: 'none' }),
  /**
   * Empty means fully refundable up to arrival. That is a deliberate default:
   * a property that has configured nothing has not agreed to keep anyone's
   * money, and inventing a penalty on their behalf would be charging a guest
   * under a rule the hotel never wrote.
   */
  cancellation: z.array(cancellationWindowSchema).default([]),
  /**
   * Whether the property wants a card on file for its no-show policy.
   * Requires explicit consent copy at the point of capture (E1.3).
   */
  vaultCard: z.boolean().default(false),
})

export type BookingPolicy = z.infer<typeof bookingPolicySchema>

/** The whole of `properties.settings` this module cares about. */
const settingsSchema = z.object({ policy: bookingPolicySchema.optional() })

/**
 * The default when a property has configured nothing.
 *
 * Nothing charged, everything refundable. The most permissive reading, chosen
 * because the alternative — a platform default that keeps money — would be a
 * term in a contract between a hotel and its guest that neither of them agreed.
 */
export const DEFAULT_POLICY: BookingPolicy = {
  deposit: { mode: 'none' },
  cancellation: [],
  vaultCard: false,
}

export function readBookingPolicy(settings: unknown): BookingPolicy {
  const parsed = settingsSchema.safeParse(settings)
  if (!parsed.success || !parsed.data.policy) return DEFAULT_POLICY

  return parsed.data.policy
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

export interface DepositQuote {
  /** Charged now. Zero means the payment step is skipped entirely. */
  dueNowCents: number
  /** The rest, settled with the property. */
  dueAtPropertyCents: number
  mode: DepositPolicy['mode']
}

export function computeDeposit(
  policy: BookingPolicy,
  stay: { totalCents: number; nightCount: number },
): DepositQuote {
  const { totalCents, nightCount } = stay

  const dueNowCents = (() => {
    switch (policy.deposit.mode) {
      case 'none':
        return 0
      case 'full':
        return totalCents
      case 'first_night':
        // Not `totalCents / nightCount` rounded per night — the sum of rounded
        // nights does not equal the total, and the difference turns up as a
        // cent the guest is short at checkout.
        return nightCount > 0 ? Math.round(totalCents / nightCount) : totalCents
      case 'percent':
        return Math.round((totalCents * policy.deposit.percent) / 100)
    }
  })()

  // Clamped rather than trusted. A percent above 100 is rejected by the schema,
  // but `first_night` on a one-night stay and a rounding artefact could both
  // land a cent over, and charging more than the stay costs is the one error a
  // guest always notices.
  const due = Math.min(Math.max(dueNowCents, 0), totalCents)

  return {
    dueNowCents: due,
    dueAtPropertyCents: totalCents - due,
    mode: policy.deposit.mode,
  }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export interface RefundQuote {
  refundCents: number
  /** Kept by the property, per policy. */
  retainedCents: number
  refundPercent: number
  /**
   * The window that applied, or null when none did — meaning either the
   * property has no windows (fully refundable) or the guest is past the last
   * one (nothing back).
   */
  appliedWindow: CancellationWindow | null
  /** Hours between now and the start of the arrival day, in the hotel's zone. */
  hoursBeforeArrival: number
}

/**
 * What comes back if the guest cancels now.
 *
 * Computed from what was actually **paid**, not from the stay total: refunding
 * a percentage of a total the guest never paid would move money that never
 * arrived. A guest who paid a 30% deposit and cancels inside a 50% window gets
 * half of the deposit back, not half of the stay.
 */
export function computeRefund(
  policy: BookingPolicy,
  input: {
    paidCents: number
    arrivalDate: string
    timezone: string
    now?: Date
  },
): RefundQuote {
  const now = input.now ?? new Date()
  const arrival = zonedStartOfDay(input.arrivalDate, input.timezone)
  const hoursBeforeArrival = (arrival.getTime() - now.getTime()) / 3_600_000

  // Largest window first, so the guest gets the most generous one they still
  // qualify for regardless of the order the property typed them in.
  const windows = [...policy.cancellation].sort(
    (a, b) => b.hoursBeforeArrival - a.hoursBeforeArrival,
  )

  if (windows.length === 0) {
    // No configured windows: fully refundable. See DEFAULT_POLICY.
    return {
      refundCents: input.paidCents,
      retainedCents: 0,
      refundPercent: 100,
      appliedWindow: null,
      hoursBeforeArrival,
    }
  }

  const applied = windows.find((window) => hoursBeforeArrival >= window.hoursBeforeArrival) ?? null

  const refundPercent = applied?.refundPercent ?? 0
  const refundCents = Math.round((input.paidCents * refundPercent) / 100)

  return {
    refundCents,
    retainedCents: input.paidCents - refundCents,
    refundPercent,
    appliedWindow: applied,
    hoursBeforeArrival,
  }
}

/**
 * Midnight on a calendar date, in a named zone, as an instant.
 *
 * Needed because arrival is a hotel-local date and a cancellation deadline is
 * an instant. Doing this with a fixed offset would be wrong twice a year in
 * every one of our markets — and wrong in the guest's favour or the hotel's
 * depending on the direction, which is the kind of bug that gets argued about.
 */
export function zonedStartOfDay(date: string, timeZone: string): Date {
  const utcMidnight = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(utcMidnight.getTime())) return utcMidnight

  const firstOffset = zoneOffsetMs(utcMidnight, timeZone)
  const candidate = new Date(utcMidnight.getTime() - firstOffset)

  // Re-checked once. On a DST boundary the offset at the guessed instant can
  // differ from the offset at the corrected one; a single correction settles
  // it for every real zone.
  const secondOffset = zoneOffsetMs(candidate, timeZone)

  return secondOffset === firstOffset ? candidate : new Date(utcMidnight.getTime() - secondOffset)
}

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)

  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)

  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    // Intl renders midnight as 24 in some locales' hour12:false output.
    read('hour') % 24,
    read('minute'),
    read('second'),
  )

  return asUtc - at.getTime()
}
