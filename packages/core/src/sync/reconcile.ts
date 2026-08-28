import { and, eq } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  discrepancies,
  externalRefs,
  properties,
  reconciliationRuns,
  reservations,
  roomTypes,
} from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { resolveAuthority } from '../authority'
import type { PmsAdapter, PmsReservation } from '../adapters/pms'

/**
 * The nightly parity pass (03-ARCHITECTURE §4).
 *
 * Compares what we hold against what the PMS holds, for one domain at one
 * property, and records where they disagree. Its output is a product surface —
 * the exceptions inbox and a trend — not a log file, which is why the results
 * land in tables an owner can read rather than in a file an engineer greps.
 *
 * The parity ratio this produces is also the evidence D11's condition C2 asks
 * for: six months of shadow parity at ≥99.9%, including an observed year-end
 * close, before the fiscal core is even discussable. That makes these rows
 * something we keep, not something we rotate.
 */

/** How far apart two amounts may be before it stops being a rounding artefact. */
const ROUNDING_TOLERANCE_CENTS = 100

/** A date out by a day either way is a timezone resolution, not a real change. */
const TZ_TOLERANCE_DAYS = 1

export interface ReconcileResult {
  runId: string
  comparedCount: number
  discrepanciesCount: number
  /** Null when nothing was comparable — a ratio over zero is not 100%. */
  parityRatio: number | null
  /**
   * What was found, so the caller can fan out one agent run per discrepancy
   * carrying the values.
   *
   * Returned rather than re-queried: the fan-out otherwise has to read back
   * rows it just wrote, and would pick up discrepancies from earlier runs at
   * the same property along with them.
   */
  found: FoundDiscrepancy[]
}

export interface FoundDiscrepancy {
  entityRef: string
  class: 'rounding' | 'tz' | 'logic'
  ours: Record<string, unknown>
  theirs: Record<string, unknown>
}

export interface FieldDivergence {
  field: string
  ours: unknown
  theirs: unknown
  class: 'rounding' | 'tz' | 'logic'
}

/**
 * Classifies how two versions of one reservation differ.
 *
 * Pure and exported, because this is the interesting logic and it deserves
 * tests that do not need a database. The classes are not cosmetic: `rounding`
 * and `tz` are *expected* divergences between two systems that compute
 * independently, and separating them is what stops a real disagreement being
 * buried under a hundred one-cent differences nobody reads.
 */
export function classifyDivergences(
  ours: {
    arrivalDate: string
    departureDate: string
    totalCents: number | null
    roomTypeCode: string | null
  },
  theirs: PmsReservation,
): FieldDivergence[] {
  const found: FieldDivergence[] = []

  if (ours.arrivalDate !== theirs.arrivalDate) {
    found.push({
      field: 'arrivalDate',
      ours: ours.arrivalDate,
      theirs: theirs.arrivalDate,
      class: withinDays(ours.arrivalDate, theirs.arrivalDate, TZ_TOLERANCE_DAYS) ? 'tz' : 'logic',
    })
  }

  if (ours.departureDate !== theirs.departureDate) {
    found.push({
      field: 'departureDate',
      ours: ours.departureDate,
      theirs: theirs.departureDate,
      class: withinDays(ours.departureDate, theirs.departureDate, TZ_TOLERANCE_DAYS)
        ? 'tz'
        : 'logic',
    })
  }

  // Only compared when both sides have a figure. A missing total on their side
  // is not a disagreement about money; it is the PMS not tracking it, and
  // reporting it as a discrepancy would train owners to ignore the inbox.
  if (ours.totalCents !== null && theirs.totalCents !== undefined) {
    if (ours.totalCents !== theirs.totalCents) {
      const apart = Math.abs(ours.totalCents - theirs.totalCents)
      found.push({
        field: 'totalCents',
        ours: ours.totalCents,
        theirs: theirs.totalCents,
        class: apart <= ROUNDING_TOLERANCE_CENTS ? 'rounding' : 'logic',
      })
    }
  }

  if (ours.roomTypeCode && ours.roomTypeCode !== theirs.roomTypeCode) {
    // A different room type is never rounding and never a timezone. Somebody
    // moved the guest, in one system and not the other.
    found.push({
      field: 'roomTypeCode',
      ours: ours.roomTypeCode,
      theirs: theirs.roomTypeCode,
      class: 'logic',
    })
  }

  return found
}

function withinDays(a: string, b: string, days: number): boolean {
  const left = Date.parse(`${a}T00:00:00Z`)
  const right = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(left) || Number.isNaN(right)) return false

  return Math.abs(left - right) <= days * 86_400_000
}

/** The worst class present decides the row's class. */
function worstClass(divergences: FieldDivergence[]): 'rounding' | 'tz' | 'logic' {
  if (divergences.some((d) => d.class === 'logic')) return 'logic'
  if (divergences.some((d) => d.class === 'tz')) return 'tz'
  return 'rounding'
}

/**
 * Runs one pass over the booking domain at one property.
 *
 * Compares only reservations that have been reflected: an unreflected one is
 * already an exception in its own right (PRD A3), and counting it here would
 * report the same problem twice under two different names.
 */
export async function reconcileBookingDomain(
  deps: { adapter: PmsAdapter },
  input: { propertyId: string },
): Promise<ReconcileResult | null> {
  const { adapter } = deps
  const { propertyId } = input

  return asService(async (db) => {
    const [property] = await db
      .select({ authorityMap: properties.authorityMap })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1)

    if (!property) return null

    // Reconciliation compares two sources. Where we are the only source there
    // is nothing to compare against, and a run recording 100% parity against
    // ourselves would be a number that means nothing but looks reassuring.
    if (resolveAuthority(property.authorityMap, 'booking') !== 'platform') {
      return null
    }

    const ours = await db
      .select({
        id: reservations.id,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        totalCents: reservations.totalCents,
        roomTypeCode: roomTypes.code,
        externalId: externalRefs.externalId,
      })
      .from(reservations)
      .innerJoin(
        externalRefs,
        and(
          eq(externalRefs.entityId, reservations.id),
          eq(externalRefs.entityType, 'reservation'),
          eq(externalRefs.system, adapter.system),
        ),
      )
      .leftJoin(roomTypes, eq(roomTypes.id, reservations.roomTypeId))
      .where(and(eq(reservations.propertyId, propertyId), eq(reservations.status, 'confirmed')))

    const [run] = await db
      .insert(reconciliationRuns)
      .values({ propertyId, domain: 'booking' })
      .returning({ id: reconciliationRuns.id })

    if (!run) throw new Error('reconciliation_runs insert returned no row')

    let compared = 0
    const rows: (typeof discrepancies.$inferInsert)[] = []
    const found: FoundDiscrepancy[] = []

    for (const reservation of ours) {
      let theirs: PmsReservation | null

      try {
        theirs = await adapter.getReservation(propertyId, reservation.externalId)
      } catch {
        // A connector that is down is a connector problem, not a parity
        // problem. Counting it as a discrepancy would blame the hotel's data
        // for our inability to read it.
        continue
      }

      compared += 1

      if (!theirs) {
        const entityRef = `reservation:${reservation.id}`
        const oursSide = { externalId: reservation.externalId, present: true }
        const missing = { present: false }

        rows.push({
          propertyId,
          runId: run.id,
          entityRef,
          class: 'logic',
          ours: oursSide,
          theirs: missing,
        })
        found.push({ entityRef, class: 'logic', ours: oursSide, theirs: missing })
        continue
      }

      const theirsReservation = theirs
      const divergences = classifyDivergences(reservation, theirsReservation)
      if (divergences.length === 0) continue

      const entityRef = `reservation:${reservation.id}`
      // The stored row keeps only the fields that diverged — that is what an
      // owner reads. The agent below gets the whole pair.
      const oursSummary = Object.fromEntries(divergences.map((d) => [d.field, d.ours]))
      const theirsSummary = Object.fromEntries(divergences.map((d) => [d.field, d.theirs]))
      const cls = worstClass(divergences)

      rows.push({
        propertyId,
        runId: run.id,
        entityRef,
        class: cls,
        ours: oursSummary,
        theirs: theirsSummary,
      })

      // The agent gets the full pair, not the summary above: it re-derives the
      // classification from the same values the comparison saw, which is what
      // makes its agreement (or disagreement) evidence rather than an echo.
      found.push({
        entityRef,
        class: cls,
        ours: {
          arrivalDate: reservation.arrivalDate,
          departureDate: reservation.departureDate,
          totalCents: reservation.totalCents,
          roomTypeCode: reservation.roomTypeCode,
        },
        theirs: theirsRecord(theirsReservation),
      })
    }

    if (rows.length > 0) {
      await db.insert(discrepancies).values(rows)
    }

    // Null rather than 1 when nothing was compared: a ratio over zero entities
    // is undefined, and reporting it as perfect parity is the kind of number
    // that gets quoted back in a board deck.
    const parityRatio = compared === 0 ? null : (compared - rows.length) / compared

    await db
      .update(reconciliationRuns)
      .set({
        comparedCount: compared,
        discrepanciesCount: rows.length,
        parityRatio: parityRatio === null ? null : parityRatio.toFixed(4),
      })
      .where(eq(reconciliationRuns.id, run.id))

    await db.transaction((tx) =>
      emit(tx, {
        propertyId,
        entityType: 'reconciliation_run',
        eventType: 'reconciliation.completed',
        origin: 'reconciliation',
        actor: systemActor,
        payload: {
          runId: run.id,
          domain: 'booking',
          compared,
          discrepancies: rows.length,
          parityRatio,
        },
      }),
    )

    return {
      runId: run.id,
      comparedCount: compared,
      discrepanciesCount: rows.length,
      parityRatio,
      found,
    }
  })
}

/** The PMS reservation as a plain record, for the agent's tool input. */
function theirsRecord(reservation: PmsReservation): Record<string, unknown> {
  return { ...reservation }
}
