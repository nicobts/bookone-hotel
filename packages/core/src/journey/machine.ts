/**
 * The guest-journey state machine (ADR-013, 03 §5).
 *
 * Pure. It knows nothing about a database, a queue or a request — it answers
 * one question: given the journey as it stands, is this command legal, and what
 * does it produce? `apply.ts` is what writes the result down.
 *
 * ## Why five dimensions rather than one status
 *
 * 03 §5 writes the happy path as a chain:
 *
 *   booking.confirmed → precheckin.invited → precheckin.submitted
 *    → documents.validated → alloggiati.staged → arrival.confirmed
 *    → alloggiati.submitted → stay.active → departure.settled → stay.closed
 *
 * That chain is a *path through* five independent dimensions, not a sixth
 * column. They genuinely move out of order: a guest states an arrival time
 * before uploading anything, documents are deleted long after arrival, and
 * Alloggiati fails and retries while the stay is already active. One column
 * would have to enumerate the product of all five, and the first real booking
 * that arrived in an unplanned order would need a new value invented for it.
 *
 * ## Why illegal transitions are refused rather than ignored
 *
 * Refusing is the entire value of the machine. "Confirm arrival for a stay that
 * was never pre-checked-in" and "submit to Alloggiati twice" are not defensive
 * hypotheticals — they are what a retried job, a double-tapped button and a
 * door sensor firing on the wrong reservation actually produce. A machine that
 * silently accepted them would leave a journey nobody can explain, and the
 * zero-touch metric (G1) is computed off these transitions.
 */

export const journeyDimensions = [
  'precheckin',
  'documents',
  'alloggiati',
  'arrival',
  'departure',
] as const

export type JourneyDimension = (typeof journeyDimensions)[number]

export type PrecheckinState = 'pending' | 'invited' | 'submitted'
export type DocumentsState = 'pending' | 'captured' | 'validated' | 'deleted'
export type AlloggiatiState = 'pending' | 'staged' | 'submitted' | 'acknowledged' | 'failed'
export type ArrivalState = 'pending' | 'expected' | 'confirmed'
export type DepartureState = 'pending' | 'settled' | 'closed'

export interface JourneyState {
  precheckin: PrecheckinState
  documents: DocumentsState
  alloggiati: AlloggiatiState
  arrival: ArrivalState
  departure: DepartureState
  expectedArrivalTime: string | null
}

export const INITIAL_JOURNEY: JourneyState = {
  precheckin: 'pending',
  documents: 'pending',
  alloggiati: 'pending',
  arrival: 'pending',
  departure: 'pending',
  expectedArrivalTime: null,
}

/**
 * Every command the journey understands.
 *
 * A closed union rather than a `{dimension, to}` pair, because a command is a
 * *thing that happened* and not an instruction to set a column. "The guest told
 * us when they are arriving" is the fact; `arrival = 'expected'` is a
 * consequence of it. Naming the fact is what lets one command move two
 * dimensions — see `precheckin.submit` — and what makes the event log read like
 * a history rather than a diff.
 */
export type JourneyCommand =
  /** The stay exists and the journey begins (03 §7.2: on confirmation). */
  | { type: 'journey.start' }
  /** The pre-arrival link went out (E2.1, T-48h). */
  | { type: 'precheckin.invite' }
  /**
   * The guest completed the pre-arrival form.
   *
   * Moves `precheckin` and, when documents came with it, `documents` too. One
   * command, because that is one thing the guest did — recording it as two
   * would make the log claim two separate visits.
   */
  | { type: 'precheckin.submit'; documentsCaptured: boolean }
  /** A document arrived on its own — a guest who came back to finish (E2.1). */
  | { type: 'documents.capture' }
  /** Staff or an agent checked the documents are legible and complete. */
  | { type: 'documents.validate' }
  /** The file is destroyed; the receipt is kept (E2.4). */
  | { type: 'documents.delete' }
  /** The guest said when they will arrive (E2.2). */
  | { type: 'arrival.expect'; time: string }
  /** They are here (E3.1). Reservation-scoped triggers only. */
  | { type: 'arrival.confirm' }
  /** Sprint 6 owns these; declared now so the machine is whole. */
  | { type: 'alloggiati.stage' }
  | { type: 'alloggiati.submit' }
  | { type: 'alloggiati.acknowledge' }
  | { type: 'alloggiati.fail' }
  | { type: 'departure.settle' }
  | { type: 'departure.close' }

export type JourneyOutcome =
  | { ok: true; next: JourneyState; changed: Partial<JourneyState> }
  /**
   * The command does not apply from here.
   *
   * `alreadyApplied` separates "this ran twice" from "this is wrong". The first
   * is a retried job and entirely normal; the second is a bug or a trigger from
   * the wrong source, and a caller that cannot tell them apart either alerts on
   * every retry or alerts on nothing.
   */
  | { ok: false; reason: string; alreadyApplied: boolean }

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

export function applyCommand(state: JourneyState, command: JourneyCommand): JourneyOutcome {
  switch (command.type) {
    case 'journey.start':
      // Idempotent by construction: starting an already-started journey is what
      // a redelivered confirmation webhook does, and it must not be an error.
      return state.precheckin === 'pending'
        ? change(state, {})
        : refused('journey already started', true)

    case 'precheckin.invite':
      if (state.precheckin === 'invited') return refused('already invited', true)
      if (state.precheckin === 'submitted') {
        // A guest who finished before the T-48h sweep reached them. Not an
        // error, and emphatically not a reason to email them again.
        return refused('already submitted', true)
      }

      return change(state, { precheckin: 'invited' })

    case 'precheckin.submit': {
      if (state.precheckin === 'submitted') return refused('already submitted', true)

      // Deliberately allowed from `pending` as well as `invited`. A guest who
      // followed a link from their confirmation email rather than waiting for
      // the invitation has done the thing we wanted; refusing because we had
      // not asked yet would be the machine enforcing its own paperwork.
      return change(state, {
        precheckin: 'submitted',
        ...(command.documentsCaptured && state.documents === 'pending'
          ? { documents: 'captured' as const }
          : {}),
      })
    }

    case 'documents.capture':
      if (state.documents === 'deleted') {
        return refused('documents were deleted for this stay', false)
      }
      if (state.documents !== 'pending') return refused('documents already captured', true)

      return change(state, { documents: 'captured' })

    case 'documents.validate':
      if (state.documents === 'validated') return refused('already validated', true)
      if (state.documents !== 'captured') {
        return refused(`cannot validate documents that are ${state.documents}`, false)
      }

      return change(state, { documents: 'validated' })

    case 'documents.delete':
      if (state.documents === 'deleted') return refused('already deleted', true)
      // Deliberately reachable from any state that is not already deleted,
      // including `pending`. E2.4 is a guest's right to have their document
      // destroyed, and a machine that refused because the paperwork had not
      // reached the expected step would be refusing the wrong thing.
      return change(state, { documents: 'deleted' })

    case 'arrival.expect': {
      if (!TIME.test(command.time)) return refused(`"${command.time}" is not a time`, false)
      if (state.arrival === 'confirmed') return refused('the guest has already arrived', false)

      // Re-statable on purpose: a guest whose train is late says so, and the
      // second answer is the true one. Not `alreadyApplied` — it changed.
      return change(state, { arrival: 'expected', expectedArrivalTime: command.time })
    }

    case 'arrival.confirm':
      if (state.arrival === 'confirmed') return refused('already arrived', true)
      if (state.departure !== 'pending') return refused('the stay has already ended', false)

      return change(state, { arrival: 'confirmed' })

    case 'alloggiati.stage':
      if (state.alloggiati === 'staged') return refused('already staged', true)
      if (state.alloggiati === 'acknowledged') {
        return refused('already acknowledged by the authority', false)
      }
      if (state.documents === 'pending') {
        return refused('nothing to stage: no documents captured', false)
      }

      return change(state, { alloggiati: 'staged' })

    case 'alloggiati.submit':
      if (state.alloggiati === 'submitted') return refused('already submitted', true)
      if (state.alloggiati === 'acknowledged') return refused('already acknowledged', true)
      if (state.alloggiati !== 'staged' && state.alloggiati !== 'failed') {
        return refused(`cannot submit from ${state.alloggiati}`, false)
      }

      return change(state, { alloggiati: 'submitted' })

    case 'alloggiati.acknowledge':
      if (state.alloggiati === 'acknowledged') return refused('already acknowledged', true)
      if (state.alloggiati !== 'submitted') {
        return refused(`cannot acknowledge from ${state.alloggiati}`, false)
      }

      return change(state, { alloggiati: 'acknowledged' })

    case 'alloggiati.fail':
      if (state.alloggiati === 'acknowledged') {
        // The authority already accepted it. A late failure is about a
        // different attempt, and recording it would erase the acceptance.
        return refused('already acknowledged', false)
      }

      return change(state, { alloggiati: 'failed' })

    case 'departure.settle':
      if (state.departure !== 'pending') return refused('already settled', true)
      if (state.arrival !== 'confirmed') {
        return refused('the guest never arrived', false)
      }

      return change(state, { departure: 'settled' })

    case 'departure.close':
      if (state.departure === 'closed') return refused('already closed', true)
      if (state.departure !== 'settled') return refused('nothing settled to close', false)

      return change(state, { departure: 'closed' })
  }
}

function change(state: JourneyState, patch: Partial<JourneyState>): JourneyOutcome {
  return { ok: true, next: { ...state, ...patch }, changed: patch }
}

function refused(reason: string, alreadyApplied: boolean): JourneyOutcome {
  return { ok: false, reason, alreadyApplied }
}

/**
 * How far along a journey is, as a fraction, for the console.
 *
 * Derived rather than stored: a progress column would be a sixth thing to keep
 * in step with five others, and the first disagreement between them would be
 * the one on screen.
 */
export function journeyProgress(state: JourneyState): number {
  const done = [
    state.precheckin === 'submitted',
    state.documents === 'validated' || state.documents === 'deleted',
    state.arrival !== 'pending',
    state.arrival === 'confirmed',
    state.departure === 'closed',
  ].filter(Boolean).length

  return done / 5
}

/**
 * What the guest still has to do (E2.1).
 *
 * The pre-arrival surface renders exactly this list, so "what is outstanding"
 * has one definition rather than one per screen.
 */
export function outstandingForGuest(state: JourneyState): ('details' | 'documents' | 'arrival')[] {
  const todo: ('details' | 'documents' | 'arrival')[] = []

  if (state.precheckin !== 'submitted') todo.push('details')
  if (state.documents === 'pending') todo.push('documents')
  if (state.arrival === 'pending') todo.push('arrival')

  return todo
}
