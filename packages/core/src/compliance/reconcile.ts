import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { AlloggiatiAdapter } from '../alloggiati/adapter'
import { asService } from '../db/session'
import { complianceEvidence, complianceObligations, properties } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { zonedStartOfDay } from '../policy/booking-policy'
import { ALLOGGIATI_ADAPTER_ID } from './alloggiati'

/**
 * The daily Alloggiati reconciliation (WP1.2): for one property and one day,
 * what fell due, what the channel acknowledged, what a person filed by hand,
 * what is still open, and whether the service holds a receipt for the day we
 * say we filed on.
 *
 * It changes nothing. An open filing is already in the exceptions inbox and on
 * the alert ladder (WP1.5); what this adds is the check no single filing can
 * make: that the authority's side of the day agrees with ours. A day we filed
 * through the channel with no receipt on the service's side is a mismatch, and
 * a mismatch is an event and an error line, for a person to look at, because
 * the only honest next step is to open the portal.
 *
 * Counts only: no guest, no reference. The event is read widely.
 *
 * A day is the property's calendar day, midnight to midnight in its own zone:
 * deadlines are set in that zone, the authority's receipts are per local day,
 * and a day around a clock change is 23 or 25 hours long.
 */
export interface DayReconciliation {
  day: string
  /** Guest registrations whose deadline fell on this day. */
  due: number
  /** Of those, acknowledged by the channel. */
  byChannel: number
  /** Of those, filed by hand, with a receipt recorded by a person. */
  byHand: number
  /** Of those, not acknowledged at all. */
  open: number
  /** Filings the channel acknowledged on this day, whatever their deadline. */
  filedThisDay: number
  /** What the service says about its receipt for this day. */
  channelReceipt: 'available' | 'missing' | 'not-checked'
  mismatch: boolean
}

export async function reconcileAlloggiatiDay(
  deps: { adapter: AlloggiatiAdapter },
  input: {
    propertyId: string
    /** `YYYY-MM-DD` in the property's zone. Defaults to its yesterday. */
    day?: string
    now?: Date
  },
): Promise<DayReconciliation> {
  const [property] = await asService((db) =>
    db
      .select({ timeZone: properties.timezone })
      .from(properties)
      .where(eq(properties.id, input.propertyId))
      .limit(1),
  )
  const timeZone = property?.timeZone ?? 'Europe/Rome'
  const day = input.day ?? addDays(localDate(input.now ?? new Date(), timeZone), -1)
  const start = zonedStartOfDay(day, timeZone)
  const end = zonedStartOfDay(addDays(day, 1), timeZone)

  const due = await asService((db) =>
    db
      .select({
        state: complianceObligations.state,
        source: sql<string | null>`(
          select e.source from compliance_evidence e
           where e.obligation_id = compliance_obligations.id
           order by e.recorded_at limit 1)`,
      })
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.propertyId, input.propertyId),
          eq(complianceObligations.adapterId, ALLOGGIATI_ADAPTER_ID),
          gte(complianceObligations.deadline, start),
          lt(complianceObligations.deadline, end),
        ),
      ),
  )

  const [filed] = await asService((db) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(complianceEvidence)
      .innerJoin(
        complianceObligations,
        eq(complianceObligations.id, complianceEvidence.obligationId),
      )
      .where(
        and(
          eq(complianceEvidence.propertyId, input.propertyId),
          eq(complianceObligations.adapterId, ALLOGGIATI_ADAPTER_ID),
          eq(complianceEvidence.source, 'channel'),
          gte(complianceEvidence.recordedAt, start),
          lt(complianceEvidence.recordedAt, end),
        ),
      ),
  )
  const filedThisDay = filed?.n ?? 0

  let channelReceipt: DayReconciliation['channelReceipt'] = 'not-checked'
  if (filedThisDay > 0 && deps.adapter.dailyReceipt) {
    const receipt = await deps.adapter.dailyReceipt({
      propertyId: input.propertyId,
      day,
    })
    channelReceipt = receipt.available ? 'available' : 'missing'
  }

  const acknowledged = due.filter((row) => row.state === 'acknowledged')
  const result: DayReconciliation = {
    day,
    due: due.length,
    byChannel: acknowledged.filter((row) => row.source === 'channel').length,
    byHand: acknowledged.filter((row) => row.source === 'manual').length,
    open: due.length - acknowledged.length,
    filedThisDay,
    channelReceipt,
    mismatch: channelReceipt === 'missing',
  }

  await asService((db) =>
    db.transaction((tx) =>
      emit(tx, {
        propertyId: input.propertyId,
        entityType: 'property',
        entityId: input.propertyId,
        eventType: 'compliance.reconciled',
        origin: 'reconciliation',
        actor: systemActor,
        payload: {
          adapterId: ALLOGGIATI_ADAPTER_ID,
          ...result,
          simulated: deps.adapter.simulated,
        },
      }),
    ),
  )

  return result
}

/** The calendar date of an instant in a zone, as `YYYY-MM-DD`. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}
