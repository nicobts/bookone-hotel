import { and, asc, desc, eq, gte, isNull, lt, or } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  feeDisputes,
  feeEvents,
  guests,
  monthlyReports,
  properties,
  reservations,
  subscriptions,
} from '../db/schema'
import { emit } from '../events'
import { systemActor, type Actor } from '../events/actor'

/**
 * The monthly revenue and fee report (E5.4, PRD C4).
 *
 * **This report is the invoice basis.** Everything about how it is built follows
 * from that, and from one further fact: the person reading it is a small-hotel
 * owner who signed a percentage-of-revenue deal with a young company, and they
 * will read it adversarially. That is the design brief, not a risk to mitigate.
 *
 * ## Draft recomputes, issued is frozen
 *
 * A draft is derived on read. Issuing writes the numbers into `snapshot` and
 * nothing recomputes them again — because the underlying rows keep moving: a
 * reservation is cancelled, a dispute is credited, a rate card changes in June
 * for a report about March. A statement that showed different numbers on two
 * readings would be the fastest available way to lose the argument this surface
 * exists to win (design-notes/monthly-report.md §4A).
 *
 * ## Nothing here is fiscal
 *
 * D11 and binding rule 6. This is the basis from which *we* invoice *them*. It
 * computes no tax, assigns no number, issues no document and transmits nothing
 * to any authority. There is no code here that could.
 */

export interface ReportLineItem {
  /**
   * The fee, not the booking.
   *
   * Both are on the line because they answer different questions: the owner
   * recognises the reservation, and the dispute is raised against the fee. An
   * earlier version of the report surface bound the dispute button to the
   * reservation id, which would have failed on every click — `fee_disputes`
   * references `fee_events`.
   */
  feeEventId: string
  reservationId: string
  reference: string
  guestName: string | null
  arrivalDate: string
  departureDate: string
  basisCents: number
  rateBps: number
  feeCents: number
  /** The chain behind an `ai_attributed` line. Empty object for a direct one. */
  evidence: Record<string, unknown>
  /** Set when this fee has been disputed, and therefore credited. */
  disputedAt: string | null
  creditCents: number
}

export interface ReportSection {
  kind: 'subscription' | 'direct_booking' | 'ai_attributed'
  /** Bookings in this section. Zero for the subscription line. */
  count: number
  /** What the percentage applied to. Null for the subscription line. */
  basisCents: number | null
  rateBps: number | null
  /** Before credits. */
  grossCents: number
  creditCents: number
  netCents: number
  items: ReportLineItem[]
}

export interface MonthlyReport {
  propertyId: string
  propertyName: string
  periodStart: string
  periodEnd: string
  currency: string
  status: 'draft' | 'issued'
  issuedAt: string | null
  sections: ReportSection[]
  totalCents: number
  /**
   * €/room/month, fees included (ADR-015, D20).
   *
   * Null when the subscription does not record a room count. Null rather than a
   * guess: this is the line an owner compares against a competitor's published
   * price, and a number derived from `room_types` — which holds *types*, not
   * rooms — would be wrong and look authoritative.
   */
  perRoomCents: number | null
  rooms: number | null
  /**
   * True while any fee in the period is younger than the dispute window.
   *
   * The report can be issued anyway; this is what the surface uses to say so.
   */
  hasOpenDisputes: boolean
}

/** First and last instant of a month, in the property's own zone. */
export function monthBounds(periodStart: string, timezone: string): { from: Date; to: Date } {
  const [year, month] = periodStart.split('-').map(Number)

  /*
   * Built by asking Intl what the offset is at that instant rather than by
   * arithmetic on a UTC date.
   *
   * A month boundary in Europe/Rome is not a fixed offset from UTC — the March
   * and October transitions move it by an hour — and a report whose period is
   * an hour wrong puts a midnight booking in the neighbouring month. Which is
   * an invoice dispute about one line, in the month either side.
   */
  const from = zonedInstant(year!, month!, 1, timezone)
  const to =
    month === 12
      ? zonedInstant(year! + 1, 1, 1, timezone)
      : zonedInstant(year!, month! + 1, 1, timezone)

  return { from, to }
}

function zonedInstant(year: number, month: number, day: number, timezone: string): Date {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // What that UTC instant reads as locally, and therefore how far to push it.
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(naive)).map((part) => [part.type, part.value]),
  ) as Record<string, string>

  const asLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )

  return new Date(naive - (asLocal - naive))
}

/** The month a date falls in, as `YYYY-MM-01`. */
export function periodOf(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

  return `${parts.slice(0, 7)}-01`
}

/**
 * Build the report for a period.
 *
 * Returns the stored snapshot when the report is issued, and derives it fresh
 * otherwise. The caller does not choose — an issued report has one answer.
 */
export async function buildReport(input: {
  propertyId: string
  periodStart: string
}): Promise<MonthlyReport | null> {
  return asService(async (db) => {
    const [property] = await db
      .select({ id: properties.id, name: properties.name, timezone: properties.timezone })
      .from(properties)
      .where(eq(properties.id, input.propertyId))
      .limit(1)

    if (!property) return null

    const [existing] = await db
      .select({
        status: monthlyReports.status,
        snapshot: monthlyReports.snapshot,
        issuedAt: monthlyReports.issuedAt,
      })
      .from(monthlyReports)
      .where(
        and(
          eq(monthlyReports.propertyId, input.propertyId),
          eq(monthlyReports.periodStart, input.periodStart),
        ),
      )
      .limit(1)

    if (existing?.status === 'issued') {
      // Frozen. Not recomputed, not merged with anything that has changed since.
      return existing.snapshot as unknown as MonthlyReport
    }

    const { from, to } = monthBounds(input.periodStart, property.timezone)

    const rows = await db
      .select({
        feeId: feeEvents.id,
        reservationId: feeEvents.reservationId,
        kind: feeEvents.kind,
        basisCents: feeEvents.basisCents,
        rateBps: feeEvents.rateBps,
        feeCents: feeEvents.feeCents,
        currency: feeEvents.currency,
        evidence: feeEvents.evidence,
        reference: reservations.reference,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        reservationStatus: reservations.status,
        guestName: guests.name,
        disputeStatus: feeDisputes.status,
        creditCents: feeDisputes.creditCents,
        creditedAt: feeDisputes.creditedAt,
      })
      .from(feeEvents)
      .innerJoin(reservations, eq(reservations.id, feeEvents.reservationId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .leftJoin(feeDisputes, eq(feeDisputes.feeEventId, feeEvents.id))
      .where(
        and(
          eq(feeEvents.propertyId, input.propertyId),
          gte(feeEvents.createdAt, from),
          lt(feeEvents.createdAt, to),
        ),
      )
      .orderBy(asc(feeEvents.createdAt))

    const [subscription] = await db
      .select({
        plan: subscriptions.plan,
        baseCents: subscriptions.baseCents,
        currency: subscriptions.currency,
        rooms: subscriptions.rooms,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.propertyId, input.propertyId),
          lt(subscriptions.startedAt, to),
          or(isNull(subscriptions.endedAt), gte(subscriptions.endedAt, from)),
        ),
      )
      .orderBy(desc(subscriptions.startedAt))
      .limit(1)

    const currency = subscription?.currency ?? rows[0]?.currency ?? 'EUR'

    const section = (kind: 'direct_booking' | 'ai_attributed'): ReportSection => {
      /*
       * A cancelled reservation's fee is excluded from the statement.
       *
       * The `fee_events` row survives — it is the record that we computed a fee
       * at confirmation, and deleting it would erase the arithmetic. But billing
       * a property for a booking that did not happen is the single most
       * indefensible line this report could carry.
       */
      const items = rows
        .filter((row) => row.kind === kind && row.reservationStatus !== 'cancelled')
        .map((row): ReportLineItem => ({
          feeEventId: row.feeId,
          reservationId: row.reservationId,
          reference: row.reference ?? '',
          guestName: row.guestName,
          arrivalDate: row.arrivalDate,
          departureDate: row.departureDate,
          basisCents: row.basisCents,
          rateBps: row.rateBps,
          feeCents: row.feeCents,
          evidence: (row.evidence ?? {}) as Record<string, unknown>,
          disputedAt: row.creditedAt ? row.creditedAt.toISOString() : null,
          // Left join: a fee with no dispute has null here, not zero.
          creditCents: row.disputeStatus === 'credited' ? (row.creditCents ?? 0) : 0,
        }))

      const grossCents = items.reduce((total, item) => total + item.feeCents, 0)
      const creditCents = items.reduce((total, item) => total + item.creditCents, 0)

      return {
        kind,
        count: items.length,
        basisCents: items.reduce((total, item) => total + item.basisCents, 0),
        // The rate is per-property and per-kind, so every item in a section
        // shares it. Reported from the first rather than assumed, so a section
        // built across a rate change is visibly odd rather than silently wrong.
        rateBps: items[0]?.rateBps ?? null,
        grossCents,
        creditCents,
        netCents: grossCents - creditCents,
        items,
      }
    }

    const subscriptionSection: ReportSection = {
      kind: 'subscription',
      count: 0,
      basisCents: null,
      rateBps: null,
      grossCents: subscription?.baseCents ?? 0,
      creditCents: 0,
      netCents: subscription?.baseCents ?? 0,
      items: [],
    }

    /*
     * Always three sections, including the empty ones (§4G).
     *
     * A month with no AI-attributed bookings shows that line at zero rather
     * than dropping it. An owner who never sees the line cannot form a view
     * about whether the rate is fair — and the first month it appears, it looks
     * like something new was introduced.
     */
    const sections = [subscriptionSection, section('direct_booking'), section('ai_attributed')]
    const totalCents = sections.reduce((total, part) => total + part.netCents, 0)
    const rooms = subscription?.rooms ?? null

    return {
      propertyId: input.propertyId,
      propertyName: property.name,
      periodStart: input.periodStart,
      periodEnd: to.toISOString().slice(0, 10),
      currency,
      status: 'draft',
      issuedAt: null,
      sections,
      totalCents,
      /*
       * The equivalence includes the percentage fees, deliberately (ADR-015).
       *
       * D20's whole point is comparability against a competitor's per-room
       * price, and a figure showing only the base would flatter us by omitting
       * the part that varies. The number shown is the number billed, or M6 is
       * damaged by the very screen built to demonstrate it.
       */
      perRoomCents: rooms && rooms > 0 ? Math.round(totalCents / rooms) : null,
      rooms,
      hasOpenDisputes: rows.some((row) => row.disputeStatus === 'open'),
    } satisfies MonthlyReport
  })
}

/**
 * Freeze a period (E5.4).
 *
 * Writes the numbers down and stops recomputing them. Idempotent: issuing an
 * already-issued report returns the stored snapshot rather than replacing it,
 * because a retried job must not restate an invoice.
 */
export async function issueReport(input: {
  propertyId: string
  periodStart: string
  actor?: Actor
}): Promise<{ status: 'issued' | 'already-issued'; report: MonthlyReport } | null> {
  const report = await buildReport(input)
  if (!report) return null

  if (report.status === 'issued') return { status: 'already-issued', report }

  const issuedAt = new Date()
  const frozen: MonthlyReport = { ...report, status: 'issued', issuedAt: issuedAt.toISOString() }

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(monthlyReports)
        .values({
          propertyId: input.propertyId,
          periodStart: input.periodStart,
          status: 'issued',
          snapshot: frozen as unknown as Record<string, unknown>,
          totalCents: frozen.totalCents,
          currency: frozen.currency,
          issuedAt,
        })
        .onConflictDoUpdate({
          target: [monthlyReports.propertyId, monthlyReports.periodStart],
          set: {
            status: 'issued',
            snapshot: frozen as unknown as Record<string, unknown>,
            totalCents: frozen.totalCents,
            issuedAt,
            updatedAt: issuedAt,
          },
          // Only a draft may be issued. Without this, a concurrent second call
          // would overwrite a snapshot that had already been sent to somebody.
          setWhere: eq(monthlyReports.status, 'draft'),
        })
        .returning({ id: monthlyReports.id })

      if (!row) {
        const [current] = await tx
          .select({ snapshot: monthlyReports.snapshot })
          .from(monthlyReports)
          .where(
            and(
              eq(monthlyReports.propertyId, input.propertyId),
              eq(monthlyReports.periodStart, input.periodStart),
            ),
          )
          .limit(1)

        return {
          status: 'already-issued' as const,
          report: (current?.snapshot ?? frozen) as unknown as MonthlyReport,
        }
      }

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'monthly_report',
        entityId: row.id,
        eventType: 'report.issued',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: { periodStart: input.periodStart, totalCents: frozen.totalCents },
      })

      return { status: 'issued' as const, report: frozen }
    }),
  )
}

/** Periods a property has, newest first, for the selector. */
export async function listReportPeriods(
  propertyId: string,
): Promise<{ periodStart: string; status: string; totalCents: number; currency: string }[]> {
  return asService((db) =>
    db
      .select({
        periodStart: monthlyReports.periodStart,
        status: monthlyReports.status,
        totalCents: monthlyReports.totalCents,
        currency: monthlyReports.currency,
      })
      .from(monthlyReports)
      .where(eq(monthlyReports.propertyId, propertyId))
      .orderBy(desc(monthlyReports.periodStart)),
  )
}

/**
 * Every property, with its timezone, for the generator's work list.
 *
 * The timezone comes back because the period is computed per property: a month
 * boundary is not the same instant everywhere, and a single period chosen by
 * the scheduler would misfile a midnight booking for any house outside its own
 * zone.
 */
export async function listPropertiesForReports(): Promise<{ id: string; timezone: string }[]> {
  return asService((db) =>
    db.select({ id: properties.id, timezone: properties.timezone }).from(properties),
  )
}

/** The month before now, in a given zone, as `YYYY-MM-01`. */
export function previousPeriod(timezone: string, now: Date = new Date()): string {
  const current = periodOf(now, timezone)
  const [year, month] = current.split('-').map(Number)

  return month === 1 ? `${year! - 1}-12-01` : `${year}-${String(month! - 1).padStart(2, '0')}-01`
}
