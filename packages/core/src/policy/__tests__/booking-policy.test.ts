import { describe, expect, it } from 'vitest'
import {
  computeDeposit,
  computeRefund,
  DEFAULT_POLICY,
  readBookingPolicy,
  zonedStartOfDay,
  type BookingPolicy,
} from '../booking-policy'

/**
 * The policy engine decides what a guest is charged and what they get back.
 *
 * It is pure, so it is tested without a database, a provider or a browser — and
 * it is tested hard, because every branch here is a number somebody is either
 * billed or refunded.
 */

const policy = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({
  ...DEFAULT_POLICY,
  ...overrides,
})

describe('computeDeposit', () => {
  it('takes nothing when the property takes nothing', () => {
    const quote = computeDeposit(policy(), { totalCents: 30_000, nightCount: 3 })

    expect(quote.dueNowCents).toBe(0)
    expect(quote.dueAtPropertyCents).toBe(30_000)
  })

  it('takes a percentage', () => {
    const quote = computeDeposit(policy({ deposit: { mode: 'percent', percent: 30 } }), {
      totalCents: 30_000,
      nightCount: 3,
    })

    expect(quote.dueNowCents).toBe(9_000)
    expect(quote.dueAtPropertyCents).toBe(21_000)
  })

  it('takes the first night as the total over the nights, not a rounded night', () => {
    // 100.01 over three nights. Rounding per night and multiplying back would
    // not equal the total, and the difference turns up as a cent the guest is
    // short at checkout.
    const quote = computeDeposit(policy({ deposit: { mode: 'first_night' } }), {
      totalCents: 10_001,
      nightCount: 3,
    })

    expect(quote.dueNowCents).toBe(3_334)
    expect(quote.dueNowCents + quote.dueAtPropertyCents).toBe(10_001)
  })

  it('takes the whole stay', () => {
    const quote = computeDeposit(policy({ deposit: { mode: 'full' } }), {
      totalCents: 30_000,
      nightCount: 3,
    })

    expect(quote.dueNowCents).toBe(30_000)
    expect(quote.dueAtPropertyCents).toBe(0)
  })

  it('never charges more than the stay costs', () => {
    // A one-night stay on `first_night` is the whole total, and a rounding
    // artefact could land a cent over. Charging more than the stay is the one
    // error a guest always notices.
    const quote = computeDeposit(policy({ deposit: { mode: 'first_night' } }), {
      totalCents: 9_999,
      nightCount: 1,
    })

    expect(quote.dueNowCents).toBe(9_999)
    expect(quote.dueAtPropertyCents).toBe(0)
  })

  it('always splits the total exactly', () => {
    for (const total of [1, 999, 10_001, 33_333, 100_000]) {
      for (const nights of [1, 2, 3, 7]) {
        const quote = computeDeposit(policy({ deposit: { mode: 'percent', percent: 33 } }), {
          totalCents: total,
          nightCount: nights,
        })

        // The invariant that matters more than any single case: what is taken
        // now plus what is owed later is the stay, to the cent, always.
        expect(quote.dueNowCents + quote.dueAtPropertyCents).toBe(total)
      }
    }
  })
})

describe('computeRefund', () => {
  const arrival = '2026-09-10'
  const timezone = 'Europe/Rome'

  /** Hours before the arrival day starts, in the property's zone. */
  const at = (hoursBefore: number) =>
    new Date(zonedStartOfDay(arrival, timezone).getTime() - hoursBefore * 3_600_000)

  it('refunds everything when the property configured no windows', () => {
    // A property that has configured nothing has not agreed to keep anyone's
    // money. Inventing a penalty on their behalf would be a contract term
    // neither they nor the guest wrote.
    const quote = computeRefund(policy(), {
      paidCents: 10_000,
      arrivalDate: arrival,
      timezone,
      now: at(1),
    })

    expect(quote.refundCents).toBe(10_000)
    expect(quote.appliedWindow).toBeNull()
  })

  const windows = policy({
    cancellation: [
      { hoursBeforeArrival: 24, refundPercent: 50 },
      { hoursBeforeArrival: 48, refundPercent: 100 },
    ],
  })

  it('applies the most generous window the guest still qualifies for', () => {
    const quote = computeRefund(windows, {
      paidCents: 10_000,
      arrivalDate: arrival,
      timezone,
      now: at(72),
    })

    expect(quote.refundPercent).toBe(100)
    expect(quote.refundCents).toBe(10_000)
  })

  it('does not depend on the order the windows were typed in', () => {
    // The property edits these in a settings form. The refund a guest receives
    // must not change because someone reordered two rows.
    const reversed = policy({
      cancellation: [
        { hoursBeforeArrival: 48, refundPercent: 100 },
        { hoursBeforeArrival: 24, refundPercent: 50 },
      ],
    })

    const a = computeRefund(windows, {
      paidCents: 10_000,
      arrivalDate: arrival,
      timezone,
      now: at(36),
    })
    const b = computeRefund(reversed, {
      paidCents: 10_000,
      arrivalDate: arrival,
      timezone,
      now: at(36),
    })

    expect(a.refundCents).toBe(b.refundCents)
    expect(a.refundCents).toBe(5_000)
  })

  it('refunds nothing past the last window', () => {
    const quote = computeRefund(windows, {
      paidCents: 10_000,
      arrivalDate: arrival,
      timezone,
      now: at(2),
    })

    expect(quote.refundCents).toBe(0)
    expect(quote.retainedCents).toBe(10_000)
    expect(quote.appliedWindow).toBeNull()
  })

  it('treats the boundary as inside the window', () => {
    // Exactly 48 hours out. A guest reading "free cancellation up to 48 hours
    // before" and cancelling at 48 hours is entitled to the answer the sentence
    // gave them.
    const quote = computeRefund(windows, {
      paidCents: 10_000,
      arrivalDate: arrival,
      timezone,
      now: at(48),
    })

    expect(quote.refundPercent).toBe(100)
  })

  it('refunds a percentage of what was paid, not of the stay', () => {
    // A guest who paid a 30% deposit and cancels inside a 50% window gets half
    // of the deposit — not half of the stay, which is money that never arrived.
    const quote = computeRefund(windows, {
      paidCents: 9_000,
      arrivalDate: arrival,
      timezone,
      now: at(30),
    })

    expect(quote.refundCents).toBe(4_500)
  })

  it('refunds nothing when nothing was paid', () => {
    const quote = computeRefund(windows, {
      paidCents: 0,
      arrivalDate: arrival,
      timezone,
      now: at(72),
    })

    expect(quote.refundCents).toBe(0)
  })
})

describe('zonedStartOfDay', () => {
  it('resolves midnight in the property’s zone, not in UTC', () => {
    // Summer in Rome is UTC+2, so the hotel's day starts at 22:00 the night
    // before in UTC. A cancellation deadline computed from UTC midnight would
    // be two hours out — in the guest's favour or the hotel's depending on the
    // season, which is the kind of bug that gets argued about.
    expect(zonedStartOfDay('2026-07-15', 'Europe/Rome').toISOString()).toBe(
      '2026-07-14T22:00:00.000Z',
    )
  })

  it('handles winter, when the offset is different', () => {
    expect(zonedStartOfDay('2026-01-15', 'Europe/Rome').toISOString()).toBe(
      '2026-01-14T23:00:00.000Z',
    )
  })

  it('handles the day the clocks change', () => {
    // Europe/Rome springs forward on 2026-03-29. Midnight that day still
    // exists, and is CET — the change happens at 02:00.
    expect(zonedStartOfDay('2026-03-29', 'Europe/Rome').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    )
  })

  it('agrees with UTC for a UTC property', () => {
    expect(zonedStartOfDay('2026-07-15', 'UTC').toISOString()).toBe('2026-07-15T00:00:00.000Z')
  })
})

describe('readBookingPolicy', () => {
  it('reads a configured policy', () => {
    const parsed = readBookingPolicy({
      policy: {
        deposit: { mode: 'percent', percent: 25 },
        cancellation: [{ hoursBeforeArrival: 48, refundPercent: 100 }],
        vaultCard: true,
      },
    })

    expect(parsed.deposit).toEqual({ mode: 'percent', percent: 25 })
    expect(parsed.vaultCard).toBe(true)
  })

  it.each([
    ['no settings at all', null],
    ['no policy configured', {}],
    ['a percentage over 100', { policy: { deposit: { mode: 'percent', percent: 150 } } }],
    ['a mode that does not exist', { policy: { deposit: { mode: 'haggle' } } }],
    [
      'a refund over 100%',
      { policy: { cancellation: [{ hoursBeforeArrival: 1, refundPercent: 200 }] } },
    ],
  ])('falls back to the permissive default for %s', (_label, settings) => {
    // A malformed policy must never become a charge. The default takes nothing
    // and refunds everything, so the failure mode of a typo in a settings blob
    // is the platform being too generous — never a guest being charged under a
    // rule nobody wrote.
    expect(readBookingPolicy(settings)).toEqual(DEFAULT_POLICY)
  })
})
