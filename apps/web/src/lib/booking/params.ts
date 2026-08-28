/**
 * The booking flow's state, as it lives in the URL.
 *
 * Steps 1 and 2 are search params on purpose (design note §3): a guest can send
 * the link to whoever is actually paying, a refresh on hotel wifi does not
 * restart the booking, and the page stays server-rendered, which is what makes
 * E1.1's one-second budget reachable.
 *
 * Everything below therefore treats the URL as hostile. It is typed by people,
 * edited by people, and shared between them.
 */

export interface BookingSearch {
  arrival: string
  departure: string
  adults: number
  children: number
}

export type ParsedSearch =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: 'dates' }
  | { kind: 'search'; search: BookingSearch }

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Guests per booking. One room per reservation in V1 (design note §5). */
const MAX_ADULTS = 8
const MAX_CHILDREN = 8

export function parseSearch(params: Record<string, string | string[] | undefined>): ParsedSearch {
  const arrival = single(params.arrival)
  const departure = single(params.departure)

  if (!arrival && !departure) return { kind: 'empty' }
  if (!isDate(arrival) || !isDate(departure)) return { kind: 'invalid', reason: 'dates' }
  if (departure <= arrival) return { kind: 'invalid', reason: 'dates' }

  return {
    kind: 'search',
    search: {
      arrival,
      departure,
      adults: clamp(single(params.adults), 1, MAX_ADULTS, 2),
      children: clamp(single(params.children), 0, MAX_CHILDREN, 0),
    },
  }
}

/**
 * A date is real, not just well-shaped.
 *
 * `2026-02-31` matches the pattern and parses to March 3rd — a guest who typed
 * it would be shown availability for dates they did not ask for, which is the
 * kind of wrong that only surfaces at the desk.
 */
function isDate(value: string | undefined): value is string {
  if (!value || !DATE.test(value)) return false

  const parsed = new Date(`${value}T00:00:00Z`)

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function single(value: string | string[] | undefined): string | undefined {
  // `?adults=2&adults=9` arrives as an array. Taking the first is arbitrary but
  // deterministic, which beats whichever one the framework happened to keep.
  return Array.isArray(value) ? value[0] : value
}

function clamp(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback

  return Math.min(Math.max(parsed, min), max)
}

/** Rebuilds the query string, so no caller assembles one by hand. */
export function searchToQuery(search: BookingSearch, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    arrival: search.arrival,
    departure: search.departure,
    adults: String(search.adults),
    children: String(search.children),
    ...extra,
  })

  return params.toString()
}
