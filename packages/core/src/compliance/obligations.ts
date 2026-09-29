import { createHash } from 'node:crypto'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '../db/schema'
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { asService, withUser } from '../db/session'
import {
  complianceEvidence,
  complianceObligations,
  externalRefs,
  journeyStates,
  properties,
  reservations,
} from '../db/schema'
import { emit } from '../events'
import { systemActor, userActor, type Actor } from '../events/actor'
import { isEntitled } from '../onboarding/entitlements'
import { registrationDeadline } from './deadlines'
import type { ComplianceAdapter, ObligationInput, ObligationType } from './adapter'
import { advance, escalateIfLate, type Next, type ObligationState, type Outcome } from './lifecycle'
import { coverageFor, readJurisdiction, resolveAdapters, type AdapterSet } from './registry'

/**
 * Obligations in the database (ADR-039): generating them, advancing them one
 * step, recording the evidence, and the lists the console and the sweep read.
 *
 * Every write runs under the service role and scopes by property explicitly
 * (ADR-007); members read through `withUser` and RLS. Every state change is a
 * domain event carrying how long the obligation waited in the state it left —
 * the wait-point data ADR-025 turns on.
 */

export interface ComplianceDeps {
  adapters: AdapterSet
  now?: () => Date
}

/** The event each state change emits (`compliance_obligation.<verb>`). */
const STATE_EVENT: Record<ObligationState, string> = {
  pending: 'waiting',
  queued: 'queued',
  submitted: 'submitted',
  acknowledged: 'acknowledged',
  failed: 'failed',
  manual: 'escalated',
}

function subjectKeyFor(reservationId: string): string {
  return `reservation:${reservationId}`
}

export interface GenerateResult {
  created: number
  /** Deadlines moved because the real arrival became known. */
  rescheduled: number
  /** Registry entries a property owes but no adapter here discharges. */
  unsupported: { propertyId: string; adapter: string }[]
}

/**
 * Creates `guest_registration` obligations from confirmed schedine and
 * arrivals (WP1.1 acceptance). Idempotent: the unique subject key makes a
 * second run a no-op, so the sweep can run every ten minutes forever and the
 * arrival path can call it for one stay without coordinating.
 *
 * A stay qualifies when a person confirmed its documents or the guest has
 * arrived, whichever comes first. The obligation starts `pending`; the
 * adapter's `validate` decides when it is ready.
 */
export async function generateGuestRegistrations(
  deps: ComplianceDeps,
  input: { limit: number; propertyId?: string; reservationId?: string },
): Promise<GenerateResult> {
  const now = deps.now?.() ?? new Date()
  const arrivedAt = sql<Date | null>`(select min(e.at) from domain_events e where e.entity_type = 'journey' and e.entity_id = ${reservations.id} and e.event_type = 'arrival.confirm')`

  const candidates = await asService((db) =>
    db
      .select({
        reservationId: reservations.id,
        propertyId: reservations.propertyId,
        arrivalDate: reservations.arrivalDate,
        timeZone: properties.timezone,
        settings: properties.settings,
        arrivedAt,
      })
      .from(reservations)
      .innerJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .innerJoin(properties, eq(properties.id, reservations.propertyId))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          or(eq(journeyStates.documents, 'validated'), eq(journeyStates.arrival, 'confirmed')),
          // Recent and upcoming stays only: an obligation for a stay that left
          // weeks ago is a breach to report by hand, not a filing to start.
          sql`${reservations.departureDate} >= (current_date - 7)`,
          input.propertyId ? eq(reservations.propertyId, input.propertyId) : undefined,
          input.reservationId ? eq(reservations.id, input.reservationId) : undefined,
        ),
      )
      .orderBy(asc(reservations.arrivalDate))
      .limit(input.limit),
  )

  const result: GenerateResult = { created: 0, rescheduled: 0, unsupported: [] }
  const entitled = new Map<string, boolean>()

  for (const stay of candidates) {
    const coverage = coverageFor(readJurisdiction(stay.settings))
    const { resolved, missing } = resolveAdapters(coverage, deps.adapters, 'guest_registration')

    for (const entry of missing) {
      result.unsupported.push({ propertyId: stay.propertyId, adapter: entry.adapter })
    }

    for (const { entry, adapter } of resolved) {
      const feature = adapter.capabilities().feature
      const gateKey = `${stay.propertyId}:${feature}`
      if (!entitled.has(gateKey)) {
        entitled.set(gateKey, await isEntitled(stay.propertyId, feature))
      }
      // Off means the property cannot reach the module (ADR-019): no
      // obligation, because nothing here would discharge it.
      if (!entitled.get(gateKey)) continue

      const deadline = registrationDeadline({
        arrivalDate: stay.arrivalDate,
        timeZone: stay.timeZone,
        arrivedAt: stay.arrivedAt ? new Date(stay.arrivedAt) : null,
      })

      const outcome = await asService((db) =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .insert(complianceObligations)
            .values({
              propertyId: stay.propertyId,
              adapterId: adapter.capabilities().id,
              authority: entry.authority,
              type: 'guest_registration',
              subjectKey: subjectKeyFor(stay.reservationId),
              reservationId: stay.reservationId,
              deadline,
              state: 'pending',
              nextAttemptAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: complianceObligations.id })

          if (row) {
            await emit(tx, {
              propertyId: stay.propertyId,
              entityType: 'compliance_obligation',
              entityId: row.id,
              eventType: 'compliance_obligation.created',
              origin: 'platform',
              actor: systemActor,
              payload: {
                adapterId: adapter.capabilities().id,
                type: 'guest_registration',
                reservationId: stay.reservationId,
                deadline: deadline.toISOString(),
              },
            })
            return 'created' as const
          }

          // Already there. Move the deadline if the arrival is now known and
          // makes it later — only ever later, and only while it is still open.
          const moved = await tx
            .update(complianceObligations)
            .set({ deadline })
            .where(
              and(
                eq(complianceObligations.propertyId, stay.propertyId),
                eq(complianceObligations.adapterId, adapter.capabilities().id),
                eq(complianceObligations.type, 'guest_registration'),
                eq(complianceObligations.subjectKey, subjectKeyFor(stay.reservationId)),
                lt(complianceObligations.deadline, deadline),
                inArray(complianceObligations.state, ['pending', 'queued', 'failed']),
              ),
            )
            .returning({ id: complianceObligations.id })

          return moved.length > 0 ? ('rescheduled' as const) : ('unchanged' as const)
        }),
      )

      if (outcome === 'created') result.created += 1
      if (outcome === 'rescheduled') result.rescheduled += 1
    }
  }

  return result
}

/** Obligations the sweep should run now: due, not final, not with a person. */
export async function listDueObligations(input: {
  limit: number
  now?: Date
}): Promise<{ id: string; propertyId: string }[]> {
  const now = input.now ?? new Date()

  return asService((db) =>
    db
      .select({ id: complianceObligations.id, propertyId: complianceObligations.propertyId })
      .from(complianceObligations)
      .where(
        and(
          inArray(complianceObligations.state, ['pending', 'queued', 'failed', 'submitted']),
          or(
            isNull(complianceObligations.nextAttemptAt),
            lte(complianceObligations.nextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(complianceObligations.deadline))
      .limit(input.limit),
  )
}

export type RunResult =
  | { status: 'advanced'; from: ObligationState; to: ObligationState }
  | { status: 'unchanged'; state: ObligationState }
  | { status: 'skipped'; reason: 'unknown' | 'final' | 'manual' | 'no-adapter' | 'feature-off' }
  /** Another run moved it first. Nothing written. */
  | { status: 'raced' }

/**
 * Advances one obligation by one step: validate, file or ask, record.
 *
 * Safe to run twice at once: every write is conditional on the state it read,
 * so the second run finds nothing to do (`raced`). Safe to run after a crash:
 * the adapter's submit is idempotent on the obligation.
 */
export async function runObligation(
  deps: ComplianceDeps,
  obligationId: string,
): Promise<RunResult> {
  const now = deps.now?.() ?? new Date()

  const [row] = await asService((db) =>
    db
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, obligationId))
      .limit(1),
  )

  if (!row) return { status: 'skipped', reason: 'unknown' }
  if (row.state === 'acknowledged') return { status: 'skipped', reason: 'final' }
  if (row.state === 'manual') return { status: 'skipped', reason: 'manual' }

  const adapter = deps.adapters.get(row.adapterId)
  if (!adapter) return { status: 'skipped', reason: 'no-adapter' }

  const capabilities = adapter.capabilities()
  if (!(await isEntitled(row.propertyId, capabilities.feature))) {
    return { status: 'skipped', reason: 'feature-off' }
  }

  const policy = capabilities.retryPolicy
  const lifecycleRow = {
    state: row.state,
    attempts: row.attempts,
    deadline: row.deadline,
    lastError: row.lastError,
  }

  const obligation: ObligationInput = {
    obligationId: row.id,
    propertyId: row.propertyId,
    type: row.type,
    reservationId: row.reservationId,
    periodDate: row.periodDate,
    deadline: row.deadline,
    attempts: row.attempts,
  }

  // Filed already: only ask the channel. Never re-validated, never escalated.
  if (row.state === 'submitted') {
    const result = await adapter.submit(obligation)
    return write(row, advance(lifecycleRow, { kind: 'submitted', result }, policy, now), {
      outcome: { kind: 'submitted', result },
      adapter,
      now,
    })
  }

  const late = escalateIfLate(lifecycleRow, policy, now)
  if (late) {
    return write(
      row,
      { ...late, lastError: late.lastError ?? 'The deadline is close: file by hand.' },
      {
        adapter,
        now,
      },
    )
  }

  const validation = await adapter.validate(obligation)
  if (!validation.ok) {
    const outcome: Outcome = { kind: 'invalid', issues: validation.issues }
    return write(row, advance(lifecycleRow, outcome, policy, now), { outcome, adapter, now })
  }

  // Ready. `pending` becomes `queued` on its own event, so the wait before a
  // person confirmed and the wait for the channel are separate numbers.
  let current = row
  if (row.state === 'pending') {
    const queued = await write(
      row,
      { state: 'queued', attempts: row.attempts, nextAttemptAt: now, lastError: null },
      { adapter, now },
    )
    if (queued.status !== 'advanced') return queued
    current = { ...row, state: 'queued', stateChangedAt: now, lastError: null }
  }

  const result = await adapter.submit({ ...obligation, attempts: current.attempts })
  const outcome: Outcome = { kind: 'submitted', result }
  return write(
    current,
    advance(
      { state: current.state, attempts: current.attempts, deadline: current.deadline },
      outcome,
      policy,
      now,
    ),
    { outcome, adapter, now },
  )
}

type ObligationRow = typeof complianceObligations.$inferSelect

/**
 * Writes one transition, conditional on the state it was computed from, with
 * its event, its evidence and the channel's reference.
 */
async function write(
  row: ObligationRow,
  next: Next,
  context: { outcome?: Outcome; adapter: ComplianceAdapter; now: Date },
): Promise<RunResult> {
  const { outcome, adapter, now } = context
  const changed =
    next.state !== row.state ||
    next.attempts !== row.attempts ||
    next.lastError !== row.lastError ||
    (next.nextAttemptAt?.getTime() ?? null) !== (row.nextAttemptAt?.getTime() ?? null)

  if (!changed) return { status: 'unchanged', state: row.state }

  const result = outcome?.kind === 'submitted' ? outcome.result : null
  const reference = result && result.status !== 'failed' ? result.reference : null

  return asService((db) =>
    db.transaction(async (tx) => {
      const updated = await tx
        .update(complianceObligations)
        .set({
          state: next.state,
          attempts: next.attempts,
          nextAttemptAt: next.nextAttemptAt,
          lastError: next.lastError,
          ...(next.state !== row.state ? { stateChangedAt: now } : {}),
        })
        .where(
          and(eq(complianceObligations.id, row.id), eq(complianceObligations.state, row.state)),
        )
        .returning({ id: complianceObligations.id })

      if (updated.length === 0) return { status: 'raced' as const }

      if (reference) {
        // The channel's id for the filing, where every foreign id lives (ADR-001).
        await tx
          .insert(externalRefs)
          .values({
            propertyId: row.propertyId,
            entityType: 'compliance_obligation',
            entityId: row.id,
            system: row.adapterId,
            externalId: reference,
          })
          .onConflictDoNothing()
      }

      if (next.state === 'acknowledged' && result?.status === 'acknowledged') {
        await insertEvidence(tx, {
          propertyId: row.propertyId,
          obligationId: row.id,
          source: 'channel',
          receipt: result.receipt,
          recordedBy: null,
        })
      }

      if (next.state !== row.state) {
        await emit(tx, {
          propertyId: row.propertyId,
          entityType: 'compliance_obligation',
          entityId: row.id,
          eventType: `compliance_obligation.${STATE_EVENT[next.state]}`,
          origin: 'platform',
          actor: systemActor,
          payload: {
            adapterId: row.adapterId,
            type: row.type,
            from: row.state,
            to: next.state,
            attempts: next.attempts,
            // The wait point ADR-025 counts: how long it sat in the state it left.
            waitedSeconds: Math.max(
              0,
              Math.round((now.getTime() - row.stateChangedAt.getTime()) / 1000),
            ),
            simulated: adapter.capabilities().simulated,
            ...(next.lastError ? { error: next.lastError } : {}),
          },
        })
        return { status: 'advanced' as const, from: row.state, to: next.state }
      }

      return { status: 'unchanged' as const, state: row.state }
    }),
  )
}

/** A transaction handle — the same shape the event emitter takes. */
type Tx = PostgresJsDatabase<typeof schema>

/** The canonical JSON of a receipt — keys sorted — so the same receipt always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function receiptHash(receipt: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(receipt)).digest('hex')
}

async function insertEvidence(
  tx: Tx,
  input: {
    propertyId: string
    obligationId: string
    source: 'channel' | 'manual'
    receipt: Record<string, unknown>
    recordedBy: string | null
  },
): Promise<string> {
  const [row] = await tx
    .insert(complianceEvidence)
    .values({
      propertyId: input.propertyId,
      obligationId: input.obligationId,
      source: input.source,
      receipt: input.receipt,
      receiptHash: receiptHash(input.receipt),
      recordedBy: input.recordedBy,
    })
    .returning({ id: complianceEvidence.id })

  if (!row) throw new Error('compliance_evidence insert returned no row')

  await emit(tx, {
    propertyId: input.propertyId,
    entityType: 'compliance_obligation',
    entityId: input.obligationId,
    eventType: 'compliance_evidence.recorded',
    origin: 'platform',
    actor: input.recordedBy ? userActor(input.recordedBy) : systemActor,
    // The hash, never the receipt: the event log is read more widely.
    payload: { evidenceId: row.id, source: input.source, hash: receiptHash(input.receipt) },
  })

  return row.id
}

export type ChannelRetryResult =
  | { status: 'acknowledged' }
  /** The channel still could not file it; it stays with a person. */
  | { status: 'still-manual'; message: string }
  /** The record does not pass the channel's checks; nothing was sent. */
  | { status: 'invalid'; messages: string[] }
  | { status: 'not-manual' }
  | { status: 'unavailable'; reason: 'unknown' | 'no-adapter' | 'feature-off' | 'raced' }

/**
 * A person asks the channel to try once more, for a filing that was handed to
 * them (WP1.2's outage drill: retries, then a person, then evidence once
 * resubmitted).
 *
 * The usual case is an outage that ended: the channel went down, the lifecycle
 * gave up two hours before the deadline, and the channel is back while there
 * is still time. Filing through it gives the channel's own receipt as
 * evidence, which is better proof than a protocol number typed in by hand.
 *
 * One attempt, now, chosen by a person. `manual` only ever moves to
 * `acknowledged` (the transition table), so a failure leaves the filing with
 * the person, with the channel's reason recorded, and the sweep never picks
 * it up again on its own. The Alloggiati bridge never re-sends a filing the
 * channel already holds, so this cannot declare the guests twice.
 */
export async function retryManualObligation(
  deps: ComplianceDeps,
  input: { propertyId: string; obligationId: string; userId: string },
): Promise<ChannelRetryResult> {
  const now = deps.now?.() ?? new Date()
  const [row] = await asService((db) =>
    db
      .select()
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.id, input.obligationId),
          eq(complianceObligations.propertyId, input.propertyId),
        ),
      )
      .limit(1),
  )
  if (!row) return { status: 'unavailable', reason: 'unknown' }
  if (row.state !== 'manual') return { status: 'not-manual' }

  const adapter = deps.adapters.get(row.adapterId)
  if (!adapter) return { status: 'unavailable', reason: 'no-adapter' }
  if (!(await isEntitled(row.propertyId, adapter.capabilities().feature))) {
    return { status: 'unavailable', reason: 'feature-off' }
  }

  const obligation: ObligationInput = {
    obligationId: row.id,
    propertyId: row.propertyId,
    type: row.type,
    reservationId: row.reservationId,
    periodDate: row.periodDate,
    deadline: row.deadline,
    attempts: row.attempts,
  }

  const validation = await adapter.validate(obligation)
  if (!validation.ok) {
    // Nothing sent. The reason goes on the stay, where the desk was told the
    // result would appear, and the attempt is on the record like any other.
    const messages = validation.issues.map((issue) => issue.message)
    const written = await write(
      row,
      {
        state: 'manual',
        attempts: row.attempts,
        nextAttemptAt: null,
        lastError: messages.join(' · '),
      },
      { adapter, now },
    )
    if (written.status === 'raced') return { status: 'unavailable', reason: 'raced' }
    await channelRetried(row, input.userId, 'invalid', adapter)
    return { status: 'invalid', messages }
  }

  const result = await adapter.submit(obligation)
  const next: Next =
    result.status === 'acknowledged'
      ? { state: 'acknowledged', attempts: row.attempts + 1, nextAttemptAt: null, lastError: null }
      : {
          state: 'manual',
          attempts: row.attempts + 1,
          nextAttemptAt: null,
          lastError:
            result.status === 'failed'
              ? result.message
              : 'The channel took it but has not confirmed it yet: check the portal before filing by hand.',
        }

  const written = await write(row, next, {
    outcome: { kind: 'submitted', result },
    adapter,
    now,
  })
  if (written.status === 'raced') return { status: 'unavailable', reason: 'raced' }

  await channelRetried(row, input.userId, result.status, adapter)

  return next.state === 'acknowledged'
    ? { status: 'acknowledged' }
    : { status: 'still-manual', message: next.lastError ?? '' }
}

/** Who asked, on the record: the transition's own event is the system's. */
async function channelRetried(
  row: ObligationRow,
  userId: string,
  outcome: string,
  adapter: ComplianceAdapter,
): Promise<void> {
  await asService((db) =>
    db.transaction((tx) =>
      emit(tx, {
        propertyId: row.propertyId,
        entityType: 'compliance_obligation',
        entityId: row.id,
        eventType: 'compliance_obligation.channel_retried',
        origin: 'platform',
        actor: userActor(userId),
        payload: { adapterId: row.adapterId, outcome, simulated: adapter.capabilities().simulated },
      }),
    ),
  )
}

/**
 * A person filed by hand and records the proof (ADR-026's fallback, closing
 * the loop). Allowed from `manual`, `failed`, `pending` and `queued`: whoever
 * filed it by hand made the automatic attempt moot. The receipt is what they
 * have — a protocol number, the portal's confirmation — as data.
 */
export async function recordManualFiling(input: {
  propertyId: string
  obligationId: string
  userId: string
  receipt: Record<string, unknown>
  now?: Date
}): Promise<{ status: 'recorded'; evidenceId: string } | { status: 'rejected'; reason: string }> {
  const now = input.now ?? new Date()
  const actor: Actor = userActor(input.userId)

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(complianceObligations)
        .where(
          and(
            eq(complianceObligations.id, input.obligationId),
            eq(complianceObligations.propertyId, input.propertyId),
          ),
        )
        .limit(1)
        .for('update')

      if (!row) return { status: 'rejected' as const, reason: 'unknown obligation' }
      if (row.state === 'acknowledged')
        return { status: 'rejected' as const, reason: 'already acknowledged' }
      if (row.state === 'submitted') {
        return {
          status: 'rejected' as const,
          reason: 'filed automatically; waiting for the answer',
        }
      }

      await tx
        .update(complianceObligations)
        .set({ state: 'acknowledged', stateChangedAt: now, nextAttemptAt: null, lastError: null })
        .where(eq(complianceObligations.id, row.id))

      const evidenceId = await insertEvidence(tx, {
        propertyId: row.propertyId,
        obligationId: row.id,
        source: 'manual',
        receipt: input.receipt,
        recordedBy: input.userId,
      })

      await emit(tx, {
        propertyId: row.propertyId,
        entityType: 'compliance_obligation',
        entityId: row.id,
        eventType: 'compliance_obligation.acknowledged',
        origin: 'platform',
        actor,
        payload: {
          adapterId: row.adapterId,
          type: row.type,
          from: row.state,
          to: 'acknowledged',
          manual: true,
          waitedSeconds: Math.max(
            0,
            Math.round((now.getTime() - row.stateChangedAt.getTime()) / 1000),
          ),
        },
      })

      return { status: 'recorded' as const, evidenceId }
    }),
  )
}

export interface ObligationView {
  id: string
  adapterId: string
  authority: string
  type: ObligationType
  state: ObligationState
  deadline: Date
  attempts: number
  lastError: string | null
  stateChangedAt: Date
  /** The alert ladder's rung reached (WP1.5): 0 none, 1 inbox, 2 staff, 3 owner. */
  alertRung: number
  evidence: { id: string; source: string; hash: string; recordedAt: Date } | null
}

/** A stay's obligations, as the member sees them (RLS). */
export async function listObligationsForStay(
  userId: string,
  propertyId: string,
  reservationId: string,
): Promise<ObligationView[]> {
  return withUser(userId, async (db) => {
    const rows = await db
      .select({
        id: complianceObligations.id,
        adapterId: complianceObligations.adapterId,
        authority: complianceObligations.authority,
        type: complianceObligations.type,
        state: complianceObligations.state,
        deadline: complianceObligations.deadline,
        attempts: complianceObligations.attempts,
        lastError: complianceObligations.lastError,
        stateChangedAt: complianceObligations.stateChangedAt,
        alertRung: complianceObligations.alertRung,
        evidenceId: complianceEvidence.id,
        evidenceSource: complianceEvidence.source,
        evidenceHash: complianceEvidence.receiptHash,
        evidenceAt: complianceEvidence.recordedAt,
      })
      .from(complianceObligations)
      .leftJoin(complianceEvidence, eq(complianceEvidence.obligationId, complianceObligations.id))
      .where(
        and(
          eq(complianceObligations.propertyId, propertyId),
          eq(complianceObligations.reservationId, reservationId),
        ),
      )
      .orderBy(asc(complianceObligations.deadline))

    return rows.map((row) => ({
      id: row.id,
      adapterId: row.adapterId,
      authority: row.authority,
      type: row.type,
      state: row.state,
      deadline: row.deadline,
      attempts: row.attempts,
      lastError: row.lastError,
      stateChangedAt: row.stateChangedAt,
      alertRung: row.alertRung,
      evidence:
        row.evidenceId && row.evidenceSource && row.evidenceHash && row.evidenceAt
          ? {
              id: row.evidenceId,
              source: row.evidenceSource,
              hash: row.evidenceHash,
              recordedAt: row.evidenceAt,
            }
          : null,
    }))
  })
}

/** One obligation, as the member sees it (RLS) — for the fallback download. */
export async function getObligationForMember(
  userId: string,
  propertyId: string,
  obligationId: string,
): Promise<{
  id: string
  adapterId: string
  reservationId: string | null
  /** The day, for a per-day obligation (WP1.3). */
  periodDate: string | null
  state: ObligationState
} | null> {
  const [row] = await withUser(userId, (db) =>
    db
      .select({
        id: complianceObligations.id,
        adapterId: complianceObligations.adapterId,
        reservationId: complianceObligations.reservationId,
        periodDate: complianceObligations.periodDate,
        state: complianceObligations.state,
      })
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.id, obligationId),
          eq(complianceObligations.propertyId, propertyId),
        ),
      )
      .limit(1),
  )
  return row ?? null
}

/** A stay's obligation ids, for the worker's arrival path. */
export async function listObligationIds(input: {
  propertyId: string
  reservationId: string
}): Promise<string[]> {
  const rows = await asService((db) =>
    db
      .select({ id: complianceObligations.id })
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.propertyId, input.propertyId),
          eq(complianceObligations.reservationId, input.reservationId),
        ),
      ),
  )
  return rows.map((row) => row.id)
}

/**
 * Records that a person downloaded a manual-fallback file. The file carries
 * the party's identity details, so who took it, and when, is in the log like
 * any other access to them. The event holds the ids, never the file.
 */
export async function noteFallbackDownloaded(input: {
  propertyId: string
  obligationId: string
  userId: string
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'compliance_obligation',
        entityId: input.obligationId,
        eventType: 'compliance_obligation.fallback_downloaded',
        origin: 'platform',
        actor: userActor(input.userId),
      })
    }),
  )
}

export interface OwnerObligationRow {
  id: string
  authority: string
  state: ObligationState
  deadline: Date
  /** The guest's name or booking reference; the day for a daily return. */
  subject: string
  /** The stay, when the filing is about one: how an answer naming it is found. */
  reservationId: string | null
  timeZone: string
}

/**
 * The owner agent's two lists (WP1.5): `due` is every filing not yet with the
 * authority, soonest deadline first; `failed` is the subset that needs a
 * person — retries running (`failed`) or handed over (`manual`).
 *
 * Service role, scoped by the property the runner fixed (ADR-007): the agent
 * cannot name another property, and nothing here writes.
 */
export async function listObligationsForOwner(
  propertyId: string,
  which: 'due' | 'failed',
  limit = 20,
): Promise<OwnerObligationRow[]> {
  const states: ObligationState[] =
    which === 'due' ? ['pending', 'queued', 'failed', 'manual'] : ['failed', 'manual']

  const rows = await asService((db) =>
    db
      .select({
        id: complianceObligations.id,
        authority: complianceObligations.authority,
        state: complianceObligations.state,
        deadline: complianceObligations.deadline,
        periodDate: complianceObligations.periodDate,
        reservationId: complianceObligations.reservationId,
        reference: reservations.reference,
        guestName: sql<
          string | null
        >`(select g.name from guests g where g.id = ${reservations.guestId})`,
        timeZone: properties.timezone,
      })
      .from(complianceObligations)
      .innerJoin(properties, eq(properties.id, complianceObligations.propertyId))
      .leftJoin(reservations, eq(reservations.id, complianceObligations.reservationId))
      .where(
        and(
          eq(complianceObligations.propertyId, propertyId),
          inArray(complianceObligations.state, states),
        ),
      )
      .orderBy(asc(complianceObligations.deadline))
      .limit(limit),
  )

  return rows.map((row) => ({
    id: row.id,
    authority: row.authority,
    state: row.state,
    deadline: row.deadline,
    subject: row.guestName ?? row.reference ?? row.periodDate ?? '—',
    reservationId: row.reservationId,
    timeZone: row.timeZone,
  }))
}
