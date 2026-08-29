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
 * Which side of D14 a booking falls on — **decided elsewhere**.
 *
 * This file used to own that decision, with a comment explaining that it was a
 * stricter proxy than the published rule because nothing recorded *when* a
 * session touched the property. `attribution_events` now does, and the rule
 * lives in `packages/core/src/billing/attribution.ts` where the window query
 * is.
 *
 * What stays here is the arithmetic: a kind, a rate, a basis, a cap. Keeping
 * them apart is what lets the rule be tested against timestamps without a
 * database and the money be tested without a rule.
 */

export function computeFee(
  rates: FeeRates,
  input: {
    totalCents: number
    /** From `decideAttribution`. This function does not decide it. */
    kind: FeeKind
    evidence: Record<string, unknown>
  },
): FeeComputation {
  const { kind, evidence } = input

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
