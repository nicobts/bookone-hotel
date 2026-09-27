import { describe, expect, it } from 'vitest'
import { registrationDeadline } from './deadlines'

const rome = 'Europe/Rome'

describe('the guest-registration deadline', () => {
  it('assumes the start of the arrival day until the arrival is recorded', () => {
    // 1 October in Rome starts at 22:00 UTC on 30 September (CEST, UTC+2).
    expect(
      registrationDeadline({
        arrivalDate: '2026-10-01',
        timeZone: rome,
        arrivedAt: null,
      }).toISOString(),
    ).toBe('2026-10-01T22:00:00.000Z')
  })

  it('counts 24 hours from an arrival recorded on the day', () => {
    const arrivedAt = new Date('2026-10-01T16:30:00Z')
    expect(
      registrationDeadline({ arrivalDate: '2026-10-01', timeZone: rome, arrivedAt }).toISOString(),
    ).toBe('2026-10-02T16:30:00.000Z')
  })

  it('never lets a late click extend the deadline past the end of the arrival day plus 24 hours', () => {
    const recordedDaysLater = new Date('2026-10-05T09:00:00Z')
    expect(
      registrationDeadline({
        arrivalDate: '2026-10-01',
        timeZone: rome,
        arrivedAt: recordedDaysLater,
      }).toISOString(),
    ).toBe('2026-10-02T22:00:00.000Z')
  })

  it('counts 24 real hours across the change of time', () => {
    // 25 October 2026: Rome leaves summer time. The day starts at 22:00 UTC
    // (still CEST at midnight); 24 hours later is 22:00 UTC, which is 23:00
    // local once the clocks have gone back.
    expect(
      registrationDeadline({
        arrivalDate: '2026-10-25',
        timeZone: rome,
        arrivedAt: null,
      }).toISOString(),
    ).toBe('2026-10-25T22:00:00.000Z')
  })
})
