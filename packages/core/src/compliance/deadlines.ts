import { zonedStartOfDay } from '../policy/booking-policy'

const HOUR = 3_600_000

/**
 * The guest-registration deadline: 24 hours from arrival (Alloggiati Web).
 *
 * Which arrival, when we know three things with different certainty:
 *
 * - **Nothing recorded yet:** the start of the arrival day, in the property's
 *   zone. Conservative on purpose — the deadline can only move later once the
 *   real arrival is known, and an escalation a few hours early costs nothing a
 *   missed one does.
 * - **Recorded during the arrival day:** that instant.
 * - **Recorded after the arrival day** (a receptionist marking someone arrived
 *   the next morning, a stay imported late): the end of the arrival day. The
 *   guest arrived on their arrival date, and a late click must not buy the
 *   property time the law does not give it.
 */
export function registrationDeadline(input: {
  arrivalDate: string
  timeZone: string
  arrivedAt: Date | null
}): Date {
  const dayStart = zonedStartOfDay(input.arrivalDate, input.timeZone)
  const dayEnd = zonedStartOfDay(nextDate(input.arrivalDate), input.timeZone)

  const from = !input.arrivedAt
    ? dayStart
    : input.arrivedAt.getTime() < dayEnd.getTime()
      ? input.arrivedAt
      : dayEnd

  return new Date(from.getTime() + 24 * HOUR)
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
