import { describe, expect, it } from 'vitest'
import {
  computeFee,
  DEFAULT_FEE_RATES,
  monthlyEquivalencePerRoomCents,
  readFeeRates,
} from '../fees'

/**
 * These rows become an invoice (D14, PRD C4).
 *
 * That is the whole reason this file is thorough: a bug here is not a wrong
 * number on a screen, it is a wrong number on a bill sent to a hotel we are
 * asking to trust us.
 */

/*
 * The classification suite used to live here and now lives in
 * `src/billing/__tests__/attribution.test.ts`.
 *
 * It moved because the decision did: Sprint 4 classified from the *presence* of
 * a session id, which is arithmetic-adjacent enough to sit beside the money.
 * D14's actual rule is a time window over `attribution_events`, and testing it
 * here would mean this file needed timestamps to assert a rounding.
 */

describe('computeFee', () => {
  it('applies the direct rate to the stay total', () => {
    const fee = computeFee(DEFAULT_FEE_RATES, {
      totalCents: 30_000,
      kind: 'direct_booking',
      evidence: {},
    })

    // 3% of €300.00
    expect(fee.kind).toBe('direct_booking')
    expect(fee.rateBps).toBe(300)
    expect(fee.feeCents).toBe(900)
  })

  it('applies the higher rate to AI-attributed business', () => {
    const fee = computeFee(DEFAULT_FEE_RATES, {
      totalCents: 30_000,
      kind: 'ai_attributed',
      evidence: {},
    })

    expect(fee.kind).toBe('ai_attributed')
    expect(fee.feeCents).toBe(3_000)
  })

  it('respects a per-booking cap on direct bookings', () => {
    const fee = computeFee(
      { ...DEFAULT_FEE_RATES, directBookingCapCents: 500 },
      { totalCents: 100_000, kind: 'direct_booking', evidence: {} },
    )

    expect(fee.feeCents).toBe(500)
    // The uncapped figure is kept, so a monthly report can show what the cap
    // saved the property — which is a conversation worth being able to have.
    expect(fee.evidence.cappedFrom).toBe(3_000)
  })

  it('rounds once, at the end', () => {
    // 3% of €1.11 is 3.33 cents. Two roundings on the way would give a
    // different answer, and across a month of bookings the difference is the
    // sort of thing that makes an invoice fail to reconcile.
    const fee = computeFee(DEFAULT_FEE_RATES, {
      totalCents: 111,
      kind: 'direct_booking',
      evidence: {},
    })

    expect(fee.feeCents).toBe(3)
  })

  it('carries the attribution evidence through onto the fee', () => {
    // Disputes resolve in the owner's favour, so an unevidenced fee is a fee we
    // drop. The chain arrives from `decideAttribution` and is stored with the
    // row rather than reconstructed later against a database that has moved on.
    const fee = computeFee(DEFAULT_FEE_RATES, {
      totalCents: 30_000,
      kind: 'ai_attributed',
      evidence: { rule: 'd14-v1', reason: 'no engine session before the conversation' },
    })

    expect(fee.evidence.rule).toBe('d14-v1')
    expect(fee.evidence.reason).toBe('no engine session before the conversation')
  })

  it('never produces a negative fee', () => {
    const fee = computeFee(
      { directBookingBps: 0, aiAttributedBps: 0 },
      { totalCents: 30_000, kind: 'direct_booking', evidence: {} },
    )

    expect(fee.feeCents).toBe(0)
  })

  it('defaults to the middle of the published band, not the top', () => {
    // A default that silently bills the maximum is a default that turns into an
    // argument the first time someone reads their invoice carefully. D14
    // publishes 2–4% direct and 8–12% attributed.
    expect(DEFAULT_FEE_RATES.directBookingBps).toBe(300)
    expect(DEFAULT_FEE_RATES.aiAttributedBps).toBe(1000)
  })
})

describe('readFeeRates', () => {
  it('reads a property’s contracted rates', () => {
    const rates = readFeeRates({ fees: { directBookingBps: 250, aiAttributedBps: 800 } })

    expect(rates.directBookingBps).toBe(250)
  })

  it.each([
    ['no settings', null],
    ['no fees configured', {}],
    ['a rate over 100%', { fees: { directBookingBps: 20_000 } }],
    ['a fractional rate', { fees: { directBookingBps: 2.5 } }],
  ])('falls back to the defaults for %s', (_label, settings) => {
    expect(readFeeRates(settings)).toEqual(DEFAULT_FEE_RATES)
  })
})

describe('monthlyEquivalencePerRoomCents', () => {
  it('includes the expected fees, because the number shown is the number billed', () => {
    // D20/ADR-015. A €/room/month figure that quietly omits the percentage fees
    // is a figure that undersells the invoice, and the first month is when the
    // property finds out.
    const perRoom = monthlyEquivalencePerRoomCents({
      subscriptionCentsPerMonth: 25_000,
      expectedFeeCentsPerMonth: 15_000,
      rooms: 20,
    })

    expect(perRoom).toBe(2_000)
  })

  it('returns null rather than dividing by zero rooms', () => {
    expect(
      monthlyEquivalencePerRoomCents({
        subscriptionCentsPerMonth: 25_000,
        expectedFeeCentsPerMonth: 0,
        rooms: 0,
      }),
    ).toBeNull()
  })
})
