import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  agentRuns,
  complianceEvidence,
  complianceObligations,
  messageThreads,
  notifications,
} from '../db/schema'
import { addDays } from '../compliance/istat'
import { localDate } from '../compliance/reconcile'
import { auditToolBoundary } from '../concierge/audit'
import { zonedStartOfDay } from '../policy/booking-policy'

/**
 * The weekly pilot report (Guest Desk WP1.7): one property's week, as counts.
 *
 * Two halves, matching the plan's two exit criteria:
 *   - **Filings** (plan §5): every obligation whose deadline fell in the week,
 *     and whether it was met — on time, late, missed, or still not due.
 *   - **The guest desk** (plan §6): turns answered, the median first response,
 *     the share of threads that needed no person, escalations, alerts that
 *     reached a phone, what the model cost, and the tool-boundary audit.
 *
 * **Counts only.** No guest's name, message or booking reference, so the
 * report can go to the operator console and, as text, to the pilot's owner
 * without carrying anybody's personal data. Service role, scoped by property
 * explicitly (ADR-007): the caller is the operator console or the worker.
 *
 * Two plan metrics are not measured, and the report says so rather than
 * showing a number: escalation precision needs a person to label each
 * escalation, and CSAT needs a survey the product does not send.
 */

/** Plan §6's targets, and §5's zero missed deadlines. */
export const PILOT_TARGETS = {
  missedFilings: 0,
  autoResolutionRate: 0.7,
  medianFirstResponseSeconds: 30,
  unsafeActions: 0,
  /** Owner interruptions against the first week, as a fraction of it. */
  interruptionsVsFirstWeek: 0.5,
} as const

export interface FilingCounts {
  authority: string
  /** Deadlines that fell in the week and have passed. */
  due: number
  /** With the authority, or received, by the deadline. */
  onTime: number
  /** Received after the deadline. */
  late: number
  /** Still not with the authority, deadline passed. */
  missed: number
  /** Of those received, recorded by a person (filed by hand). */
  byHand: number
  /** Deadline in the week but still ahead. */
  notYetDue: number
}

export interface WeeklyPilotReport {
  propertyId: string
  timeZone: string
  /** Monday, `YYYY-MM-DD`, in the property's zone. */
  weekStart: string
  /** The Sunday it ends on. */
  weekEnd: string
  filings: FilingCounts[]
  desk: {
    /** Threads with at least one guest message in the week. */
    threads: number
    /** Guest turns (a guest message following anything but a guest message). */
    turns: number
    /** Turns with no answer yet. */
    unansweredTurns: number
    medianFirstResponseSeconds: number | null
    /** Threads the assistant answered with no staff message and no escalation in the week. */
    autoResolved: number
    autoResolutionRate: number | null
    escalations: number
    /** Alert messages sent to the property's phones in the week (WP1.5). */
    phoneAlerts: number
    /** Escalations plus phone alerts: what reached a person. */
    interruptions: number
    costCents: number
    costPerThreadCents: number | null
    /** Agent replies the tool-boundary audit checked, and what it found. */
    repliesChecked: number
    unsafeActions: number
  }
  /** Not measured by the product; the report says so. */
  notMeasured: ('escalationPrecision' | 'csat')[]
}

/** The Monday of the week a date falls in, `YYYY-MM-DD`. */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() // 0 Sunday … 6 Saturday
  return addDays(date, -((day + 6) % 7))
}

/** The Monday of last week, in the property's zone: what the weekly job reports on. */
export function lastWeekStart(now: Date, timeZone: string): string {
  return addDays(weekStartOf(localDate(now, timeZone)), -7)
}

const OPEN = ['pending', 'queued', 'failed', 'manual'] as const

/** Pure: the filing counts from the week's obligations. */
export function countFilings(
  rows: readonly {
    authority: string
    state: string
    deadline: Date
    stateChangedAt: Date
    evidenceSource: string | null
  }[],
  now: Date,
): FilingCounts[] {
  const by = new Map<string, FilingCounts>()
  for (const row of rows) {
    let entry = by.get(row.authority)
    if (!entry) {
      entry = {
        authority: row.authority,
        due: 0,
        onTime: 0,
        late: 0,
        missed: 0,
        byHand: 0,
        notYetDue: 0,
      }
      by.set(row.authority, entry)
    }
    const passed = row.deadline.getTime() <= now.getTime()
    const filed = row.state === 'acknowledged' || row.state === 'submitted'
    const late = filed && row.stateChangedAt.getTime() > row.deadline.getTime()

    if (!passed && !filed) {
      entry.notYetDue += 1
      continue
    }
    entry.due += 1
    if (!filed && (OPEN as readonly string[]).includes(row.state)) entry.missed += 1
    else if (late) entry.late += 1
    else entry.onTime += 1
    if (row.state === 'acknowledged' && row.evidenceSource === 'manual') entry.byHand += 1
  }
  return [...by.values()].sort((a, b) => a.authority.localeCompare(b.authority))
}

/** One property's week. `now` bounds what counts as passed. */
export async function weeklyPilotReport(
  propertyId: string,
  options: { weekStart: string; timeZone: string; now?: Date },
): Promise<WeeklyPilotReport> {
  const now = options.now ?? new Date()
  const start = zonedStartOfDay(options.weekStart, options.timeZone)
  const end = zonedStartOfDay(addDays(options.weekStart, 7), options.timeZone)
  // Raw SQL below takes the bounds as ISO strings: postgres-js serialises a
  // Date only where Drizzle knows the column's type.
  const from = start.toISOString()
  const until = end.toISOString()

  const obligations = await asService((db) =>
    db
      .select({
        authority: complianceObligations.authority,
        state: complianceObligations.state,
        deadline: complianceObligations.deadline,
        stateChangedAt: complianceObligations.stateChangedAt,
        evidenceSource: complianceEvidence.source,
      })
      .from(complianceObligations)
      .leftJoin(complianceEvidence, eq(complianceEvidence.obligationId, complianceObligations.id))
      .where(
        and(
          eq(complianceObligations.propertyId, propertyId),
          gte(complianceObligations.deadline, start),
          lt(complianceObligations.deadline, end),
        ),
      ),
  )

  const [turns] = await asService((db) =>
    db.execute<{ turns: number; answered: number; median: number | null }>(sql`
      with m as (
        select id, thread_id, author, created_at,
               lag(author) over (partition by thread_id order by created_at, id) as prev
          from messages
         where property_id = ${propertyId}
      ),
      t as (
        select m.created_at,
               (select min(r.created_at) from messages r
                 where r.thread_id = m.thread_id
                   and r.author in ('agent', 'staff')
                   and r.created_at >= m.created_at) as answered_at
          from m
         where m.author = 'guest'
           and (m.prev is null or m.prev <> 'guest')
           and m.created_at >= ${from} and m.created_at < ${until}
      )
      select count(*)::int as turns,
             count(answered_at)::int as answered,
             percentile_cont(0.5) within group (
               order by extract(epoch from (answered_at - created_at))
             )::float as median
        from t`),
  )

  const [threads] = await asService((db) =>
    db.execute<{ threads: number; auto: number }>(sql`
      with active as (
        select distinct thread_id from messages
         where property_id = ${propertyId} and author = 'guest'
           and created_at >= ${from} and created_at < ${until}
      )
      select count(*)::int as threads,
             count(*) filter (
               where exists (
                 select 1 from messages g
                  where g.thread_id = a.thread_id and g.author = 'agent'
                    and g.created_at >= ${from} and g.created_at < ${until})
                 and not exists (
                 select 1 from messages s
                  where s.thread_id = a.thread_id and s.author = 'staff'
                    and s.created_at >= ${from} and s.created_at < ${until})
                 and not exists (
                 select 1 from message_threads mt
                  where mt.id = a.thread_id
                    and mt.escalated_at >= ${from} and mt.escalated_at < ${until})
             )::int as auto
        from active a`),
  )

  const [escalations] = await asService((db) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.propertyId, propertyId),
          gte(messageThreads.escalatedAt, start),
          lt(messageThreads.escalatedAt, end),
        ),
      ),
  )

  const [alerts] = await asService((db) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.propertyId, propertyId),
          eq(notifications.alert, true),
          inArray(notifications.channel, ['sms', 'whatsapp']),
          gte(notifications.createdAt, start),
          lt(notifications.createdAt, end),
        ),
      ),
  )

  const [cost] = await asService((db) =>
    db
      .select({ cents: sql<number>`coalesce(sum(${agentRuns.costCents}), 0)::int` })
      .from(agentRuns)
      .where(
        and(eq(agentRuns.propertyId, propertyId), gte(agentRuns.at, start), lt(agentRuns.at, end)),
      ),
  )

  const audit = await auditToolBoundary({ propertyId, since: start, until: end })

  const threadCount = threads?.threads ?? 0
  const autoResolved = threads?.auto ?? 0
  const escalated = escalations?.n ?? 0
  const phoneAlerts = alerts?.n ?? 0
  const costCents = cost?.cents ?? 0

  return {
    propertyId,
    timeZone: options.timeZone,
    weekStart: options.weekStart,
    weekEnd: addDays(options.weekStart, 6),
    filings: countFilings(obligations, now),
    desk: {
      threads: threadCount,
      turns: turns?.turns ?? 0,
      unansweredTurns: (turns?.turns ?? 0) - (turns?.answered ?? 0),
      medianFirstResponseSeconds: turns?.median ?? null,
      autoResolved,
      autoResolutionRate: threadCount > 0 ? autoResolved / threadCount : null,
      escalations: escalated,
      phoneAlerts,
      interruptions: escalated + phoneAlerts,
      costCents,
      costPerThreadCents: threadCount > 0 ? Math.round(costCents / threadCount) : null,
      repliesChecked: audit.checked,
      unsafeActions: audit.violations.length,
    },
    notMeasured: ['escalationPrecision', 'csat'],
  }
}

export type TargetState = 'met' | 'missed' | 'no-data'

/**
 * Each target, met or missed, for the week. `firstWeek` is the report of the
 * pilot's first week, for the interruptions target (−50% against it).
 */
export function assessTargets(
  report: WeeklyPilotReport,
  firstWeek?: WeeklyPilotReport | null,
): Record<keyof typeof PILOT_TARGETS, TargetState> {
  const missed = report.filings.reduce((sum, f) => sum + f.missed, 0)
  const due = report.filings.reduce((sum, f) => sum + f.due, 0)
  const { desk } = report
  const baseline = firstWeek?.desk.interruptions ?? null
  return {
    missedFilings: due === 0 ? 'no-data' : missed === 0 ? 'met' : 'missed',
    autoResolutionRate:
      desk.autoResolutionRate === null
        ? 'no-data'
        : desk.autoResolutionRate >= PILOT_TARGETS.autoResolutionRate
          ? 'met'
          : 'missed',
    medianFirstResponseSeconds:
      desk.medianFirstResponseSeconds === null
        ? 'no-data'
        : desk.medianFirstResponseSeconds <= PILOT_TARGETS.medianFirstResponseSeconds
          ? 'met'
          : 'missed',
    unsafeActions:
      desk.repliesChecked === 0 ? 'no-data' : desk.unsafeActions === 0 ? 'met' : 'missed',
    interruptionsVsFirstWeek:
      baseline === null || baseline === 0 || !firstWeek || firstWeek.weekStart === report.weekStart
        ? 'no-data'
        : desk.interruptions <= baseline * PILOT_TARGETS.interruptionsVsFirstWeek
          ? 'met'
          : 'missed',
  }
}

const TEXT = {
  it: {
    title: (from: string, to: string) => `Resoconto settimanale BookOne, dal ${from} al ${to}`,
    filings: 'Adempimenti',
    filingLine: (f: FilingCounts) =>
      `- ${f.authority}: ${f.due} in scadenza, ${f.onTime} in tempo, ${f.late} in ritardo, ${f.missed} mancati, ${f.byHand} inviati a mano`,
    noFilings: '- Nessuna scadenza nella settimana.',
    desk: 'Messaggi degli ospiti',
    deskLines: (d: WeeklyPilotReport['desk']) => [
      `- Conversazioni: ${d.threads}; turni: ${d.turns}, senza risposta: ${d.unansweredTurns}`,
      `- Tempo mediano della prima risposta: ${d.medianFirstResponseSeconds === null ? 'n/d' : `${Math.round(d.medianFirstResponseSeconds)} s`}`,
      `- Risolte senza una persona: ${d.autoResolutionRate === null ? 'n/d' : `${Math.round(d.autoResolutionRate * 100)}%`}`,
      `- Passate a una persona: ${d.escalations}; avvisi al telefono: ${d.phoneAlerts}`,
      `- Costo del modello: ${(d.costCents / 100).toFixed(2).replace('.', ',')} €${d.costPerThreadCents === null ? '' : ` (${(d.costPerThreadCents / 100).toFixed(2).replace('.', ',')} € per conversazione)`}`,
      `- Risposte controllate: ${d.repliesChecked}; azioni non sicure: ${d.unsafeActions}`,
    ],
    notMeasured: 'Non misurati: precisione dei passaggi a una persona, soddisfazione degli ospiti.',
  },
  en: {
    title: (from: string, to: string) => `BookOne weekly report, ${from} to ${to}`,
    filings: 'Filings',
    filingLine: (f: FilingCounts) =>
      `- ${f.authority}: ${f.due} due, ${f.onTime} on time, ${f.late} late, ${f.missed} missed, ${f.byHand} filed by hand`,
    noFilings: '- No deadlines in the week.',
    desk: 'Guest messages',
    deskLines: (d: WeeklyPilotReport['desk']) => [
      `- Conversations: ${d.threads}; turns: ${d.turns}, unanswered: ${d.unansweredTurns}`,
      `- Median first response: ${d.medianFirstResponseSeconds === null ? 'n/a' : `${Math.round(d.medianFirstResponseSeconds)} s`}`,
      `- Resolved without a person: ${d.autoResolutionRate === null ? 'n/a' : `${Math.round(d.autoResolutionRate * 100)}%`}`,
      `- Handed to a person: ${d.escalations}; phone alerts: ${d.phoneAlerts}`,
      `- Model cost: €${(d.costCents / 100).toFixed(2)}${d.costPerThreadCents === null ? '' : ` (€${(d.costPerThreadCents / 100).toFixed(2)} per conversation)`}`,
      `- Replies checked: ${d.repliesChecked}; unsafe actions: ${d.unsafeActions}`,
    ],
    notMeasured: 'Not measured: escalation precision, guest satisfaction.',
  },
} as const

/**
 * The report as plain text, for the operator to send to the pilot's owner.
 * Italian by default: the pilots are in Friuli Venezia Giulia.
 */
export function weeklyReportText(report: WeeklyPilotReport, locale: 'it' | 'en' = 'it'): string {
  const t = TEXT[locale]
  return [
    t.title(report.weekStart, report.weekEnd),
    '',
    t.filings,
    ...(report.filings.length > 0 ? report.filings.map(t.filingLine) : [t.noFilings]),
    '',
    t.desk,
    ...t.deskLines(report.desk),
    '',
    t.notMeasured,
    '',
  ].join('\n')
}

/**
 * The first week the property did anything this report counts: its first
 * guest message or its first obligation. The baseline for the interruptions
 * target. Null for a property with neither.
 */
export async function firstActivityWeek(
  propertyId: string,
  timeZone: string,
): Promise<string | null> {
  const [row] = await asService((db) =>
    db.execute<{ first: Date | string | null }>(sql`
      select least(
        (select min(created_at) from messages where property_id = ${propertyId} and author = 'guest'),
        (select min(created_at) from compliance_obligations where property_id = ${propertyId})
      ) as first`),
  )
  if (!row?.first) return null
  return weekStartOf(localDate(new Date(row.first), timeZone))
}

export interface PropertyFilingSla extends FilingCounts {
  propertyId: string
}

/**
 * Filings across every property for the last `days` days, per property and
 * authority (WP1.7's obligations SLA): the operator's one table for "did any
 * pilot miss a deadline this week". Counts only.
 */
export async function filingSlaByProperty(
  options: { days?: number; now?: Date } = {},
): Promise<PropertyFilingSla[]> {
  const now = options.now ?? new Date()
  const since = new Date(now.getTime() - (options.days ?? 7) * 86_400_000)
  const rows = await asService((db) =>
    db
      .select({
        propertyId: complianceObligations.propertyId,
        authority: complianceObligations.authority,
        state: complianceObligations.state,
        deadline: complianceObligations.deadline,
        stateChangedAt: complianceObligations.stateChangedAt,
        evidenceSource: complianceEvidence.source,
      })
      .from(complianceObligations)
      .leftJoin(complianceEvidence, eq(complianceEvidence.obligationId, complianceObligations.id))
      .where(
        and(gte(complianceObligations.deadline, since), lt(complianceObligations.deadline, now)),
      ),
  )
  const byProperty = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byProperty.get(row.propertyId) ?? []
    list.push(row)
    byProperty.set(row.propertyId, list)
  }
  return [...byProperty.entries()].flatMap(([propertyId, list]) =>
    countFilings(list, now).map((counts) => ({ propertyId, ...counts })),
  )
}
