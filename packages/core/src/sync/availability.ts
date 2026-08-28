import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { asService } from '../db/session'
import { rateSnapshots, roomTypes } from '../db/schema'
import type { PmsAdapter } from '../adapters/pms'

/**
 * Refresh the availability cache for one property (03 §4, PRD A2).
 *
 * `rate_snapshots` is a **display cache and never an authority**. Nothing here
 * can change what a guest is owed; the worst a bad refresh does is show a stale
 * price, which the provenance columns make traceable back to this fetch.
 *
 * That is also why the booking surface reads `fetched_at` and refuses to show
 * anything older than five minutes: the guard lives at the point of display,
 * because this job can fail silently — a PMS that is down simply does not
 * answer — and a cache with no freshness check would keep serving yesterday's
 * prices with complete confidence.
 */

export interface RefreshResult {
  written: number
  skipped: number
  fetchedAt: Date
}

export async function refreshAvailability(
  deps: { adapter: PmsAdapter },
  input: { propertyId: string; from: string; to: string },
): Promise<RefreshResult> {
  const { adapter } = deps
  const { propertyId, from, to } = input

  const result = await adapter.getAvailability({ propertyId, from, to })

  return asService(async (db) => {
    // Room type codes are the property's own, and the connector speaks in them.
    // Anything we do not recognise is dropped rather than guessed at: inventing
    // a room type from a code would put a room on the booking surface that the
    // hotel does not have.
    const known = await db
      .select({ id: roomTypes.id, code: roomTypes.code })
      .from(roomTypes)
      .where(eq(roomTypes.propertyId, propertyId))

    const byCode = new Map(known.map((row) => [row.code, row.id]))

    const rows: (typeof rateSnapshots.$inferInsert)[] = []
    let skipped = 0

    for (const entry of result.entries) {
      const roomTypeId = byCode.get(entry.roomTypeCode)

      if (!roomTypeId) {
        skipped += 1
        continue
      }

      rows.push({
        propertyId,
        roomTypeId,
        // One snapshot per night. `date_to` is exclusive everywhere else in
        // this codebase, so a single night is [date, date+1).
        dateFrom: entry.date,
        dateTo: addDay(entry.date),
        priceCents: entry.priceCents,
        currency: entry.currency,
        source: adapter.system,
        fetchedAt: result.fetchedAt,
      })
    }

    if (rows.length === 0) {
      return { written: 0, skipped, fetchedAt: result.fetchedAt }
    }

    await db.transaction(async (tx) => {
      // Replace the window rather than accumulate. Snapshots are a cache, and a
      // table that only ever grows would serve two prices for one night and
      // leave the surface picking between them by insertion order.
      await tx.delete(rateSnapshots).where(
        and(
          eq(rateSnapshots.propertyId, propertyId),
          eq(rateSnapshots.source, adapter.system),
          gte(rateSnapshots.dateFrom, from),
          lte(rateSnapshots.dateFrom, to),
          inArray(
            rateSnapshots.roomTypeId,
            rows.map((row) => row.roomTypeId),
          ),
        ),
      )

      await tx.insert(rateSnapshots).values(rows)
    })

    // No `domain_events` row. Binding rule 2 covers mutations of domain state,
    // and this is a cache refresh of data we are not authoritative for — an
    // event per night per room type per five minutes would bury every real
    // event in the log under noise, which is the opposite of what the rule is
    // protecting. The provenance lives on the rows themselves.
    return { written: rows.length, skipped, fetchedAt: result.fetchedAt }
  })
}

function addDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
