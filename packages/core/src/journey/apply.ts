import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { asService } from '../db/session'
import { journeyStates, reservations } from '../db/schema'
import type * as schema from '../db/schema'
import { emit } from '../events'
import { systemActor, type Actor } from '../events/actor'
import { applyCommand, INITIAL_JOURNEY, type JourneyCommand, type JourneyState } from './machine'

/**
 * The only thing that writes `journey_states` (ADR-013, binding rule 4).
 *
 * Every trigger source — the console, the pre-arrival surface, an agent, the
 * voice concierge, later a door sensor — comes through here. That is the whole
 * discipline the ADR asks for, and it buys three things a status column cannot:
 *
 *   - illegal transitions are refused rather than written
 *   - every transition emits its event in the **same transaction** as the state
 *     change, so the log and the table cannot disagree
 *   - the zero-touch metric (G1) is computable from the events alone, because
 *     no transition exists that did not produce one
 *
 * A module that reaches for `db.update(journeyStates)` is a module whose
 * transitions nobody can audit, replay or count. There is deliberately no
 * exported helper that would let it.
 */

type Tx = PostgresJsDatabase<typeof schema>

export type ApplyOutcome =
  | { status: 'applied'; state: JourneyState; changed: Partial<JourneyState> }
  /** The command had already taken effect. Normal for a retried job. */
  | { status: 'no-op'; state: JourneyState; reason: string }
  /** The command does not apply from here. This one is worth looking at. */
  | { status: 'refused'; state: JourneyState; reason: string }
  | { status: 'unknown-reservation' }

export interface ApplyInput {
  propertyId: string
  reservationId: string
  command: JourneyCommand
  /** Who or what triggered it. Defaults to `system` — a job, not a person. */
  actor?: Actor
  /** The event that caused this, when there was one (06 §3 agent triggers). */
  triggerEventId?: bigint
}

/**
 * Applies one command, in its own transaction.
 *
 * Runs under `asService`: the guest surface has no session (ADR-007) and the
 * worker legitimately spans properties. Every query below still scopes by
 * `property_id` explicitly — service role is not permission to write an
 * unscoped query (binding rule 3).
 */
export async function applyJourneyCommand(input: ApplyInput): Promise<ApplyOutcome> {
  return asService((db) => db.transaction((tx) => applyJourneyCommandIn(tx, input)))
}

/**
 * The same thing, inside a transaction the caller already owns.
 *
 * Exists so a command can commit together with the thing that caused it —
 * confirming a booking starts its journey, and a confirmation that committed
 * without its journey would leave a stay nothing is tracking.
 */
export async function applyJourneyCommandIn(tx: Tx, input: ApplyInput): Promise<ApplyOutcome> {
  const { propertyId, reservationId, command } = input

  const [existing] = await tx
    .select({
      precheckin: journeyStates.precheckin,
      documents: journeyStates.documents,
      alloggiati: journeyStates.alloggiati,
      arrival: journeyStates.arrival,
      departure: journeyStates.departure,
      expectedArrivalTime: journeyStates.expectedArrivalTime,
    })
    .from(journeyStates)
    .where(
      and(eq(journeyStates.reservationId, reservationId), eq(journeyStates.propertyId, propertyId)),
    )
    .limit(1)

  if (!existing) {
    // No journey yet. Only `journey.start` may create one — every other command
    // arriving first means something ran out of order, and inserting a row to
    // accommodate it would hide that.
    if (command.type !== 'journey.start') {
      const [reservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
        .limit(1)

      if (!reservation) return { status: 'unknown-reservation' }

      return {
        status: 'refused',
        state: INITIAL_JOURNEY,
        reason: `the journey has not started; cannot apply ${command.type}`,
      }
    }

    const [reservation] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!reservation) return { status: 'unknown-reservation' }

    await tx
      .insert(journeyStates)
      .values({ reservationId, propertyId })
      // A redelivered confirmation webhook starts the journey twice. One row.
      .onConflictDoNothing({ target: journeyStates.reservationId })

    await emitTransition(tx, input, INITIAL_JOURNEY, {})

    return { status: 'applied', state: INITIAL_JOURNEY, changed: {} }
  }

  const current: JourneyState = { ...existing }
  const outcome = applyCommand(current, command)

  if (!outcome.ok) {
    return outcome.alreadyApplied
      ? { status: 'no-op', state: current, reason: outcome.reason }
      : { status: 'refused', state: current, reason: outcome.reason }
  }

  // Nothing moved — `journey.start` on an existing row reaches here only via
  // the no-op path above, so an empty patch means the command was legal and
  // changed nothing. Still worth an event: it is a thing that happened.
  await tx
    .update(journeyStates)
    .set({ ...outcome.changed, updatedAt: new Date() })
    .where(
      and(eq(journeyStates.reservationId, reservationId), eq(journeyStates.propertyId, propertyId)),
    )

  await emitTransition(tx, input, outcome.next, outcome.changed)

  return { status: 'applied', state: outcome.next, changed: outcome.changed }
}

async function emitTransition(
  tx: Tx,
  input: ApplyInput,
  next: JourneyState,
  changed: Partial<JourneyState>,
): Promise<void> {
  await emit(tx, {
    propertyId: input.propertyId,
    entityType: 'journey',
    entityId: input.reservationId,
    // The command name *is* the event type. They are the same fact, and giving
    // them different vocabularies would mean maintaining a translation table
    // whose only purpose is to be wrong occasionally.
    eventType: input.command.type,
    origin: 'platform',
    actor: input.actor ?? systemActor,
    payload: {
      changed,
      precheckin: next.precheckin,
      documents: next.documents,
      arrival: next.arrival,
      ...(input.triggerEventId ? { triggerEventId: input.triggerEventId.toString() } : {}),
    },
  })
}

/** The journey as it stands, or null if it has not started. */
export async function readJourney(
  propertyId: string,
  reservationId: string,
): Promise<JourneyState | null> {
  return asService(async (db) => {
    const [row] = await db
      .select({
        precheckin: journeyStates.precheckin,
        documents: journeyStates.documents,
        alloggiati: journeyStates.alloggiati,
        arrival: journeyStates.arrival,
        departure: journeyStates.departure,
        expectedArrivalTime: journeyStates.expectedArrivalTime,
      })
      .from(journeyStates)
      .where(
        and(
          eq(journeyStates.reservationId, reservationId),
          eq(journeyStates.propertyId, propertyId),
        ),
      )
      .limit(1)

    return row ? { ...row } : null
  })
}
