import { and, eq, gte, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { properties, rateSnapshots, roomTypes } from '../db/schema'
import { nightsBetween, quoteStay, readTouristTaxPolicy, touristTaxNote } from './quote'
import type { SnapshotNight, StayQuote, TouristTaxNote } from './quote'

/**
 * The availability search behind step 1 of the booking flow (E1.1).
 *
 * Reads `rate_snapshots` and nothing else. That table is a display cache and
 * never an authority (03 §2), which shapes every decision here:
 *
 *   * a room type is offered only when the cache prices **every** night of the
 *     stay — a partial answer would be a cheaper stay than the real one
 *   * when the cache is stale the surface says so and offers a request form; it
 *     does not show the last known price and it does not show an empty list,
 *     because an empty list reads as "no rooms" (design note §4C)
 *   * every option carries the snapshot ids it was priced from (PRD A2)
 *
 * Runs under `asService`: a guest is anonymous and holds no JWT for a policy to
 * read (ADR-007). Every query below therefore scopes by `property_id`
 * explicitly, and that scoping *is* the isolation for this surface, not a
 * convenience on top of one (binding rule 3).
 */

/**
 * How old the cache may be before the surface stops trusting it.
 *
 * The refresh job runs every two minutes, so this is roughly seven missed
 * refreshes. Deliberately not one or two: falling back costs a real direct
 * booking, and a threshold that trips on a single slow poll would convert
 * ordinary connector jitter into lost revenue for the hotel. Seven consecutive
 * failures is a connector that is actually down, which is the case the fallback
 * is for.
 */
export const AVAILABILITY_MAX_AGE_MS = 15 * 60 * 1000

export interface SearchInput {
  propertyId: string
  arrival: string
  departure: string
  adults: number
  children: number
}

export interface RoomOption {
  roomTypeId: string
  code: string
  nameI18n: Record<string, string>
  capacity: number
  quote: StayQuote
}

export type SearchOutcome =
  | {
      status: 'ok'
      options: RoomOption[]
      nightCount: number
      /** The oldest fetch backing any option — what freshness the guest is seeing. */
      fetchedAt: Date
      touristTax: TouristTaxNote | null
    }
  /**
   * The cache cannot be trusted. The surface shows the request form.
   *
   * `fetchedAt` is null when nothing has ever been fetched for this property —
   * a property mid-onboarding, which looks identical to a stale one from the
   * guest's side and should.
   */
  | { status: 'stale'; fetchedAt: Date | null }
  /** Departure not after arrival, party of zero — a malformed request. */
  | { status: 'invalid'; reason: string }

export async function searchAvailability(input: SearchInput): Promise<SearchOutcome> {
  const { propertyId, arrival, departure, adults, children } = input

  const nights = nightsBetween(arrival, departure)
  if (nights.length === 0) return { status: 'invalid', reason: 'departure must follow arrival' }
  if (adults < 1) return { status: 'invalid', reason: 'a stay needs at least one adult' }
  if (children < 0) return { status: 'invalid', reason: 'children cannot be negative' }

  const party = adults + children

  return asService(async (db) => {
    const [property] = await db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1)

    if (!property) return { status: 'invalid', reason: 'unknown property' }

    // One query for the whole window, joined to room types so a snapshot
    // pointing at a room type this property does not have cannot leak in.
    const rows = await db
      .select({
        roomTypeId: roomTypes.id,
        code: roomTypes.code,
        nameI18n: roomTypes.nameI18n,
        capacity: roomTypes.capacity,
        snapshotId: rateSnapshots.id,
        date: rateSnapshots.dateFrom,
        priceCents: rateSnapshots.priceCents,
        currency: rateSnapshots.currency,
        fetchedAt: rateSnapshots.fetchedAt,
      })
      .from(rateSnapshots)
      .innerJoin(roomTypes, eq(roomTypes.id, rateSnapshots.roomTypeId))
      .where(
        and(
          eq(rateSnapshots.propertyId, propertyId),
          eq(roomTypes.propertyId, propertyId),
          gte(rateSnapshots.dateFrom, arrival),
          lt(rateSnapshots.dateFrom, departure),
        ),
      )

    if (rows.length === 0) {
      // Nothing at all for this window. Indistinguishable from a connector that
      // has never answered, and treated the same way: we do not know, so we
      // say we do not know.
      return { status: 'stale', fetchedAt: null }
    }

    // The oldest fetch in the window decides freshness, not the newest. A
    // refresh that half-succeeded leaves fresh rows next to stale ones, and
    // taking the newest would let the fresh half vouch for the stale half.
    const oldestFetch = rows.reduce(
      (oldest, row) => (row.fetchedAt < oldest ? row.fetchedAt : oldest),
      rows[0]!.fetchedAt,
    )

    if (Date.now() - oldestFetch.getTime() > AVAILABILITY_MAX_AGE_MS) {
      return { status: 'stale', fetchedAt: oldestFetch }
    }

    const byRoomType = new Map<string, { row: (typeof rows)[number]; nights: SnapshotNight[] }>()

    for (const row of rows) {
      const entry = byRoomType.get(row.roomTypeId) ?? { row, nights: [] }
      entry.nights.push({
        date: row.date,
        priceCents: row.priceCents,
        currency: row.currency,
        snapshotId: row.snapshotId,
      })
      byRoomType.set(row.roomTypeId, entry)
    }

    const options: RoomOption[] = []

    for (const entry of byRoomType.values()) {
      // Capacity is per room, and V1 books one room per reservation (design
      // note §5). A party that does not fit is not an option, and offering it
      // anyway would produce an arrival the hotel cannot honour.
      if (entry.row.capacity < party) continue

      const result = quoteStay(arrival, departure, entry.nights)
      // A gap in the window is not an error to report — it is a room that is
      // not available for this stay, which is the ordinary case.
      if (!result.ok) continue

      options.push({
        roomTypeId: entry.row.roomTypeId,
        code: entry.row.code,
        nameI18n: asNameMap(entry.row.nameI18n),
        capacity: entry.row.capacity,
        quote: result.quote,
      })
    }

    // Cheapest first. The comparison step's whole job is comparison, and price
    // order is what both reference implementations settled on.
    options.sort((a, b) => a.quote.totalCents - b.quote.totalCents)

    const policy = readTouristTaxPolicy(property.settings)

    return {
      status: 'ok',
      options,
      nightCount: nights.length,
      fetchedAt: oldestFetch,
      touristTax: policy
        ? touristTaxNote(policy, { nightCount: nights.length, adults, children })
        : null,
    }
  })
}

/** `name_i18n` is jsonb, so it is `unknown` until something checks it. */
function asNameMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}
