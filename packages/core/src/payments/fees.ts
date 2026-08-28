import { z } from 'zod'

/**
 * What the platform earns on a booking (D14, PRD §6).
 *
 * Pure. Computed once, at confirmation, from the values true at that moment and
 * written to `fee_events` — never recomputed on read. The monthly report built
 * on those rows **is the invoice** (PRD C4), and an invoice that changes when a
 * rate card changes is an invoice that gets disputed and lost.
 */

/**
 * Basis points, integer. 2.5% is 250.
 *
 * A float rate against a cents basis reintroduces exactly the rounding this
 * codebase keeps out of money everywhere else — and the error would land in a
 * number we bill someone.
 */
export const feeRatesSchema = z.object({
  /** D14: 2–4% capped. 3% is the middle of the published band. */
  directBookingBps: z.number().int().min(0).max(10_000).default(300),
  /** D14: 8–12% on AI-attributed incremental business. */
  aiAttributedBps: z.number().int().min(0).max(10_000).default(1000),
  /** Per-booking ceiling, if the contract has one. D14 says direct is capped. */
  directBookingCapCents: z.number().int().positive().optional(),
})

export type FeeRates = z.infer<typeof feeRatesSchema>

const settingsSchema = z.object({ fees: feeRatesSchema.optional() })

/**
 * The rates when a property's contract has not been recorded.
 *
 * Deliberately the *middle* of D14's published bands rather than the top: a
 * default that silently bills the maximum is a default that turns into an
 * argument the first time someone reads their invoice carefully.
 */
export const DEFAULT_FEE_RATES: FeeRates = {
  directBookingBps: 300,
  aiAttributedBps: 1000,
}

export function readFeeRates(settings: unknown): FeeRates {
  const parsed = settingsSchema.safeParse(settings)
  if (!parsed.success || !parsed.data.fees) return DEFAULT_FEE_RATES

  return parsed.data.fees
}

export type FeeKind = 'direct_booking' | 'ai_attributed'

export interface FeeComputation {
  kind: FeeKind
  basisCents: number
  rateBps: number
  feeCents: number
  /** Why this kind, kept with the fee so a dispute can be answered (PRD §6). */
  evidence: Record<string, unknown>
}

/**
 * Which side of D14 a booking falls on.
 *
 * The V1 attribution rule, conservatively: AI-attributed only when a concierge
 * session is present **and** no engine session preceded it. Anything else is a
 * direct booking, which is the cheaper fee — so every ambiguous case resolves
 * in the owner's favour, exactly as D14 requires.
 *
 * The published rule says "within 24h", and this implementation uses a stricter
 * proxy: the presence of an engine session id on the reservation at all. We do
 * not yet store session timestamps, and the honest options were a stricter rule
 * or a guessed one. A stricter rule under-bills; a guessed one bills someone
 * for something we cannot evidence. `attribution_events` in Sprint 8 replaces
 * this with the real window, and it can only ever move fees *up* — which is the
 * direction that requires a conversation rather than a refund.
 */
export function classifyBooking(reservation: {
  engineSessionId: string | null
  conciergeSessionId: string | null
}): { kind: FeeKind; evidence: Record<string, unknown> } {
  const hasConcierge = Boolean(reservation.conciergeSessionId)
  const hasEngine = Boolean(reservation.engineSessionId)

  if (hasConcierge && !hasEngine) {
    return {
      kind: 'ai_attributed',
      evidence: {
        rule: 'v1-conservative',
        conciergeSessionId: reservation.conciergeSessionId,
        enginePreceded: false,
        note: 'engine-session window is the Sprint 8 attribution_events job; presence used as the conservative proxy',
      },
    }
  }

  return {
    kind: 'direct_booking',
    evidence: {
      rule: 'v1-conservative',
      hasConcierge,
      hasEngine,
    },
  }
}

export function computeFee(
  rates: FeeRates,
  input: {
    totalCents: number
    engineSessionId: string | null
    conciergeSessionId: string | null
  },
): FeeComputation {
  const { kind, evidence } = classifyBooking(input)

  const rateBps = kind === 'ai_attributed' ? rates.aiAttributedBps : rates.directBookingBps

  // Integer arithmetic throughout: basis points are per ten-thousand, so this
  // divides once, at the end, and rounds once.
  const raw = Math.round((input.totalCents * rateBps) / 10_000)

  const capped =
    kind === 'direct_booking' && rates.directBookingCapCents !== undefined
      ? Math.min(raw, rates.directBookingCapCents)
      : raw

  return {
    kind,
    basisCents: input.totalCents,
    rateBps,
    feeCents: Math.max(capped, 0),
    evidence: {
      ...evidence,
      ...(capped !== raw ? { cappedFrom: raw, capCents: rates.directBookingCapCents } : {}),
    },
  }
}

/**
 * The €/room/month equivalence D20 and ADR-015 require alongside every quote
 * and every monthly report.
 *
 * "The number shown is the number billed" — so this includes the expected
 * percentage fees, not just the subscription. Exported here rather than in the
 * reporting module because it is the same arithmetic in both places, and two
 * implementations of a number that appears on an invoice will disagree.
 */
export function monthlyEquivalencePerRoomCents(input: {
  subscriptionCentsPerMonth: number
  expectedFeeCentsPerMonth: number
  rooms: number
}): number | null {
  if (input.rooms <= 0) return null

  return Math.round(
    (input.subscriptionCentsPerMonth + input.expectedFeeCentsPerMonth) / input.rooms,
  )
}
