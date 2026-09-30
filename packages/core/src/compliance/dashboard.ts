import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { asService, withUser } from '../db/session'
import {
  complianceAttachments,
  complianceEvidence,
  complianceObligations,
  reservations,
} from '../db/schema'
import { emit } from '../events'
import { userActor } from '../events/actor'
import { zonedStartOfDay } from '../policy/booking-policy'
import { csvCell } from './csv'
import type { ObligationType } from './adapter'
import { addDays } from './istat'
import type { ObligationState } from './lifecycle'
import { localDate } from './reconcile'

/**
 * The compliance dashboard and the inspection export (WP1.6).
 *
 * Both read as the member (`withUser`, RLS): what a person sees here is what
 * the database lets them see, and a property's filings are the property's.
 * Both take the adapters the property has switched on, so a module that is off
 * shows nothing (ADR-019); the caller reads the features.
 */

/** The most open filings the dashboard lists; the counts cover them all. */
export const OPEN_LIST_LIMIT = 500

/** Not yet with the authority, and a person may have to act. */
const OPEN_STATES: readonly ObligationState[] = ['pending', 'queued', 'failed', 'manual']

export interface DashboardRow {
  id: string
  adapterId: string
  authority: string
  type: ObligationType
  state: ObligationState
  deadline: Date
  stateChangedAt: Date
  lastError: string | null
  reservationId: string | null
  /** The booking reference, for a stay. */
  reference: string | null
  /** The day, for a daily return. */
  periodDate: string | null
  subjectKey: string
}

export interface AuthorityToday {
  adapterId: string
  authority: string
  /** Open, and due before the end of the property's day. */
  dueToday: number
  /** Open, and past its deadline. */
  overdue: number
  /** With the authority, answer awaited. */
  submitted: number
  /** Retrying (`failed`) or handed to a person (`manual`). */
  failed: number
  /** Acknowledged since the start of the property's day. */
  acknowledgedToday: number
}

export interface ComplianceToday {
  /** The property's date, `YYYY-MM-DD`. */
  date: string
  authorities: AuthorityToday[]
  /** Everything not acknowledged, soonest deadline first, at most `OPEN_LIST_LIMIT`. */
  open: (DashboardRow & { overdue: boolean })[]
}

/**
 * The day's counts per authority, from the rows. Pure, so the arithmetic is
 * tested without a database. An obligation counts once in `dueToday` or
 * `overdue` and, independently, in `failed` when a person may have to act.
 */
export function summariseToday(
  rows: readonly DashboardRow[],
  window: { now: Date; dayStart: Date; dayEnd: Date },
): Omit<ComplianceToday, 'date'> {
  const byAdapter = new Map<string, AuthorityToday>()
  const open: ComplianceToday['open'] = []

  for (const row of rows) {
    let entry = byAdapter.get(row.adapterId)
    if (!entry) {
      entry = {
        adapterId: row.adapterId,
        authority: row.authority,
        dueToday: 0,
        overdue: 0,
        submitted: 0,
        failed: 0,
        acknowledgedToday: 0,
      }
      byAdapter.set(row.adapterId, entry)
    }

    const isOpen = OPEN_STATES.includes(row.state)
    const overdue = isOpen && row.deadline.getTime() <= window.now.getTime()

    if (overdue) entry.overdue += 1
    else if (isOpen && row.deadline.getTime() < window.dayEnd.getTime()) entry.dueToday += 1
    if (row.state === 'submitted') entry.submitted += 1
    if (row.state === 'failed' || row.state === 'manual') entry.failed += 1
    if (row.state === 'acknowledged' && row.stateChangedAt.getTime() >= window.dayStart.getTime()) {
      entry.acknowledgedToday += 1
    }

    if (row.state !== 'acknowledged') open.push({ ...row, overdue })
  }

  open.sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
  const authorities = [...byAdapter.values()].sort((a, b) => a.adapterId.localeCompare(b.adapterId))
  return { authorities, open }
}

const dashboardColumns = {
  id: complianceObligations.id,
  adapterId: complianceObligations.adapterId,
  authority: complianceObligations.authority,
  type: complianceObligations.type,
  state: complianceObligations.state,
  deadline: complianceObligations.deadline,
  stateChangedAt: complianceObligations.stateChangedAt,
  lastError: complianceObligations.lastError,
  reservationId: complianceObligations.reservationId,
  reference: reservations.reference,
  periodDate: complianceObligations.periodDate,
  subjectKey: complianceObligations.subjectKey,
}

/**
 * Today, for one property: every obligation still open, whatever its
 * deadline, plus those acknowledged since the start of the property's day.
 */
export async function complianceToday(
  userId: string,
  propertyId: string,
  options: { adapterIds: readonly string[]; timeZone: string; now?: Date },
): Promise<ComplianceToday> {
  const now = options.now ?? new Date()
  const date = localDate(now, options.timeZone)
  const dayStart = zonedStartOfDay(date, options.timeZone)
  const dayEnd = zonedStartOfDay(addDays(date, 1), options.timeZone)

  if (options.adapterIds.length === 0) return { date, authorities: [], open: [] }

  const rows = await withUser(userId, async (db) => {
    const scope = and(
      eq(complianceObligations.propertyId, propertyId),
      inArray(complianceObligations.adapterId, [...options.adapterIds]),
    )
    const pending = await db
      .select(dashboardColumns)
      .from(complianceObligations)
      .leftJoin(reservations, eq(reservations.id, complianceObligations.reservationId))
      .where(
        and(scope, inArray(complianceObligations.state, [...OPEN_STATES, 'submitted' as const])),
      )
      .orderBy(asc(complianceObligations.deadline))
    const done = await db
      .select(dashboardColumns)
      .from(complianceObligations)
      .leftJoin(reservations, eq(reservations.id, complianceObligations.reservationId))
      .where(
        and(
          scope,
          eq(complianceObligations.state, 'acknowledged'),
          gte(complianceObligations.stateChangedAt, dayStart),
        ),
      )
    return [...pending, ...done]
  })

  // Counted over every open row; only the list is bounded, so a property with
  // a backlog still sees its true counts.
  const summary = summariseToday(rows, { now, dayStart, dayEnd })
  return { date, authorities: summary.authorities, open: summary.open.slice(0, OPEN_LIST_LIMIT) }
}

// ---------------------------------------------------------------------------
// The inspection export
// ---------------------------------------------------------------------------

export interface InspectionRow {
  obligationId: string
  adapterId: string
  authority: string
  type: ObligationType
  /** The booking reference, the day, or the subject key when the stay is gone. */
  subject: string
  deadline: Date
  state: ObligationState
  /** When it was acknowledged; null while it is not. */
  acknowledgedAt: Date | null
  evidence: {
    source: string
    hash: string
    recordedAt: Date
    /** As recorded, or `{}` after the retention purge (the hash still proves it). */
    receipt: Record<string, unknown>
    purgedAt: Date | null
  } | null
  attachment: { sha256: string; contentType: string; deletedAt: Date | null } | null
}

export interface InspectionExport {
  from: string
  to: string
  timeZone: string
  rows: InspectionRow[]
  counts: { total: number; acknowledged: number; open: number; withoutEvidence: number }
}

/**
 * Every obligation whose deadline falls in the period, in the property's own
 * days, with its evidence. An inspector asks for a period; the export answers
 * with everything owed in it, filed or not, so a gap is visible rather than
 * left out. `counts.withoutEvidence` counts acknowledged filings with no
 * receipt, which should always be zero: acknowledgement writes the evidence in
 * the same transaction.
 */
export async function inspectionExport(
  userId: string,
  propertyId: string,
  options: { from: string; to: string; timeZone: string; adapterIds: readonly string[] },
): Promise<InspectionExport> {
  const start = zonedStartOfDay(options.from, options.timeZone)
  const end = zonedStartOfDay(addDays(options.to, 1), options.timeZone)

  const rows =
    options.adapterIds.length === 0
      ? []
      : await withUser(userId, (db) =>
          db
            .select({
              obligationId: complianceObligations.id,
              adapterId: complianceObligations.adapterId,
              authority: complianceObligations.authority,
              type: complianceObligations.type,
              subjectKey: complianceObligations.subjectKey,
              periodDate: complianceObligations.periodDate,
              reference: reservations.reference,
              deadline: complianceObligations.deadline,
              state: complianceObligations.state,
              stateChangedAt: complianceObligations.stateChangedAt,
              evidenceSource: complianceEvidence.source,
              evidenceHash: complianceEvidence.receiptHash,
              evidenceAt: complianceEvidence.recordedAt,
              receipt: complianceEvidence.receipt,
              purgedAt: complianceEvidence.receiptPurgedAt,
              attachmentSha: complianceAttachments.sha256,
              attachmentType: complianceAttachments.contentType,
              attachmentDeletedAt: complianceAttachments.deletedAt,
            })
            .from(complianceObligations)
            .leftJoin(reservations, eq(reservations.id, complianceObligations.reservationId))
            .leftJoin(
              complianceEvidence,
              eq(complianceEvidence.obligationId, complianceObligations.id),
            )
            .leftJoin(
              complianceAttachments,
              eq(complianceAttachments.evidenceId, complianceEvidence.id),
            )
            .where(
              and(
                eq(complianceObligations.propertyId, propertyId),
                inArray(complianceObligations.adapterId, [...options.adapterIds]),
                gte(complianceObligations.deadline, start),
                lt(complianceObligations.deadline, end),
              ),
            )
            .orderBy(asc(complianceObligations.deadline), asc(complianceObligations.id)),
        )

  const out: InspectionRow[] = rows.map((row) => ({
    obligationId: row.obligationId,
    adapterId: row.adapterId,
    authority: row.authority,
    type: row.type,
    subject: row.reference ?? row.periodDate ?? row.subjectKey,
    deadline: row.deadline,
    state: row.state,
    acknowledgedAt: row.state === 'acknowledged' ? row.stateChangedAt : null,
    evidence:
      row.evidenceSource && row.evidenceHash && row.evidenceAt
        ? {
            source: row.evidenceSource,
            hash: row.evidenceHash,
            recordedAt: row.evidenceAt,
            receipt: (row.receipt ?? {}) as Record<string, unknown>,
            purgedAt: row.purgedAt,
          }
        : null,
    attachment:
      row.attachmentSha && row.attachmentType
        ? {
            sha256: row.attachmentSha,
            contentType: row.attachmentType,
            deletedAt: row.attachmentDeletedAt,
          }
        : null,
  }))

  const acknowledged = out.filter((row) => row.state === 'acknowledged')
  return {
    from: options.from,
    to: options.to,
    timeZone: options.timeZone,
    rows: out,
    counts: {
      total: out.length,
      acknowledged: acknowledged.length,
      open: out.length - acknowledged.length,
      withoutEvidence: acknowledged.filter((row) => !row.evidence).length,
    },
  }
}

/** The receipt's own reference, whichever name the channel or the person gave it. */
function receiptReference(receipt: Record<string, unknown>): string {
  for (const key of ['protocol', 'reference', 'receiptNumber', 'ticket']) {
    const value = receipt[key]
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }
  return ''
}

/**
 * The export as semicolon CSV, the separator an Italian spreadsheet opens
 * without asking. Times are in the property's zone. The receipt goes in whole,
 * as JSON, so nothing the authority returned is lost in the flattening; its
 * hash is beside it for anyone who wants to check it.
 */
export function inspectionCsv(data: InspectionExport): string {
  const time = (at: Date | null) =>
    at ? at.toLocaleString('sv-SE', { timeZone: data.timeZone, hour12: false }).slice(0, 16) : ''
  const header = [
    'autorita',
    'adempimento',
    'oggetto',
    'scadenza',
    'stato',
    'ricevuto_il',
    'fonte',
    'riferimento',
    'sha256_ricevuta',
    'ricevuta_json',
    'ricevuta_eliminata_il',
    'sha256_file',
    'file_eliminato_il',
  ]
  const lines = data.rows.map((row) =>
    [
      row.authority,
      row.type,
      row.subject,
      time(row.deadline),
      row.state,
      time(row.acknowledgedAt),
      row.evidence?.source ?? '',
      row.evidence ? receiptReference(row.evidence.receipt) : '',
      row.evidence?.hash ?? '',
      row.evidence ? JSON.stringify(row.evidence.receipt) : '',
      time(row.evidence?.purgedAt ?? null),
      row.attachment?.sha256 ?? '',
      time(row.attachment?.deletedAt ?? null),
    ]
      .map(csvCell)
      .join(';'),
  )
  return [header.join(';'), ...lines, ''].join('\r\n')
}

/**
 * Records that a person took the inspection export. It lists booking
 * references and receipts, so who took it, and for which period, is in the log.
 */
export async function noteInspectionExported(input: {
  propertyId: string
  userId: string
  from: string
  to: string
  rows: number
}): Promise<void> {
  await asService((db) =>
    db.transaction((tx) =>
      emit(tx, {
        propertyId: input.propertyId,
        entityType: 'property',
        entityId: input.propertyId,
        eventType: 'compliance.inspection_exported',
        origin: 'platform',
        actor: userActor(input.userId),
        payload: { from: input.from, to: input.to, rows: input.rows },
      }),
    ),
  )
}

// ---------------------------------------------------------------------------
// One obligation, for its screen
// ---------------------------------------------------------------------------

export interface ObligationDetail extends DashboardRow {
  evidence: {
    source: string
    hash: string
    recordedAt: Date
    receipt: Record<string, unknown>
    purgedAt: Date | null
  } | null
  attachment: {
    path: string
    contentType: string
    sizeBytes: number
    deletedAt: Date | null
  } | null
}

/** One obligation with its evidence and file, as the member sees it (RLS). */
export async function getObligationDetail(
  userId: string,
  propertyId: string,
  obligationId: string,
): Promise<ObligationDetail | null> {
  const [row] = await withUser(userId, (db) =>
    db
      .select({
        ...dashboardColumns,
        evidenceSource: complianceEvidence.source,
        evidenceHash: complianceEvidence.receiptHash,
        evidenceAt: complianceEvidence.recordedAt,
        receipt: complianceEvidence.receipt,
        purgedAt: complianceEvidence.receiptPurgedAt,
        attachmentPath: complianceAttachments.path,
        attachmentType: complianceAttachments.contentType,
        attachmentSize: complianceAttachments.sizeBytes,
        attachmentDeletedAt: complianceAttachments.deletedAt,
      })
      .from(complianceObligations)
      .leftJoin(reservations, eq(reservations.id, complianceObligations.reservationId))
      .leftJoin(complianceEvidence, eq(complianceEvidence.obligationId, complianceObligations.id))
      .leftJoin(complianceAttachments, eq(complianceAttachments.evidenceId, complianceEvidence.id))
      .where(
        and(
          eq(complianceObligations.id, obligationId),
          eq(complianceObligations.propertyId, propertyId),
        ),
      )
      .limit(1),
  )
  if (!row) return null

  const {
    evidenceSource,
    evidenceHash,
    evidenceAt,
    receipt,
    purgedAt,
    attachmentPath,
    attachmentType,
    attachmentSize,
    attachmentDeletedAt,
    ...rest
  } = row
  return {
    ...rest,
    evidence:
      evidenceSource && evidenceHash && evidenceAt
        ? {
            source: evidenceSource,
            hash: evidenceHash,
            recordedAt: evidenceAt,
            receipt: (receipt ?? {}) as Record<string, unknown>,
            purgedAt,
          }
        : null,
    attachment:
      attachmentPath && attachmentType && attachmentSize !== null
        ? {
            path: attachmentPath,
            contentType: attachmentType,
            sizeBytes: attachmentSize,
            deletedAt: attachmentDeletedAt,
          }
        : null,
  }
}
