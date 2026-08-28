import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  INITIAL_JOURNEY,
  journeyProgress,
  outstandingForGuest,
  type JourneyCommand,
  type JourneyState,
} from '../machine'

/**
 * The journey machine (ADR-013).
 *
 * Pure, so it is tested exhaustively and without a database. Most of what
 * follows asserts *refusals* — that is the machine's job. Accepting every
 * command would be a status column with extra steps.
 */

const state = (overrides: Partial<JourneyState> = {}): JourneyState => ({
  ...INITIAL_JOURNEY,
  ...overrides,
})

/** Applies a sequence, asserting each step succeeded. Returns the end state. */
function run(from: JourneyState, ...commands: JourneyCommand[]): JourneyState {
  return commands.reduce((current, command) => {
    const outcome = applyCommand(current, command)
    if (!outcome.ok) throw new Error(`${command.type} refused: ${outcome.reason}`)

    return outcome.next
  }, from)
}

describe('the happy path from 03 §5', () => {
  it('runs end to end', () => {
    const end = run(
      state(),
      { type: 'journey.start' },
      { type: 'precheckin.invite' },
      { type: 'precheckin.submit', documentsCaptured: true },
      { type: 'documents.validate' },
      { type: 'alloggiati.stage' },
      { type: 'arrival.confirm' },
      { type: 'alloggiati.submit' },
      { type: 'alloggiati.acknowledge' },
      { type: 'documents.delete' },
      { type: 'departure.settle' },
      { type: 'departure.close' },
    )

    expect(end).toMatchObject({
      precheckin: 'submitted',
      documents: 'deleted',
      alloggiati: 'acknowledged',
      arrival: 'confirmed',
      departure: 'closed',
    })
  })
})

describe('idempotence — what a retried job does', () => {
  it.each<[string, JourneyState, JourneyCommand]>([
    ['journey.start twice', state({ precheckin: 'invited' }), { type: 'journey.start' }],
    ['invite twice', state({ precheckin: 'invited' }), { type: 'precheckin.invite' }],
    [
      'submit twice',
      state({ precheckin: 'submitted' }),
      { type: 'precheckin.submit', documentsCaptured: false },
    ],
    ['capture twice', state({ documents: 'captured' }), { type: 'documents.capture' }],
    ['validate twice', state({ documents: 'validated' }), { type: 'documents.validate' }],
    ['delete twice', state({ documents: 'deleted' }), { type: 'documents.delete' }],
    ['arrive twice', state({ arrival: 'confirmed' }), { type: 'arrival.confirm' }],
    [
      'close twice',
      state({ arrival: 'confirmed', departure: 'closed' }),
      { type: 'departure.close' },
    ],
  ])('%s is a no-op, not an error', (_label, from, command) => {
    const outcome = applyCommand(from, command)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return

    // The distinction that matters: a retried job is normal and must not alert;
    // an illegal transition is a bug and must. A caller that cannot tell them
    // apart either alerts on every retry or on nothing.
    expect(outcome.alreadyApplied).toBe(true)
  })
})

describe('refusals that are bugs, not retries', () => {
  it.each<[string, JourneyState, JourneyCommand]>([
    ['validating documents that were never captured', state(), { type: 'documents.validate' }],
    [
      'capturing a document that was deleted under E2.4',
      state({ documents: 'deleted' }),
      { type: 'documents.capture' },
    ],
    ['settling a departure for a guest who never arrived', state(), { type: 'departure.settle' }],
    [
      'closing a departure that was never settled',
      state({ arrival: 'confirmed' }),
      { type: 'departure.close' },
    ],
    ['staging Alloggiati with nothing to stage', state(), { type: 'alloggiati.stage' }],
    [
      'acknowledging a submission that never happened',
      state({ documents: 'captured' }),
      { type: 'alloggiati.acknowledge' },
    ],
    [
      'arriving after the stay ended',
      state({ arrival: 'pending', departure: 'settled' }),
      { type: 'arrival.confirm' },
    ],
    ['a nonsense arrival time', state(), { type: 'arrival.expect', time: 'sometime after lunch' }],
    ['an out-of-range arrival time', state(), { type: 'arrival.expect', time: '25:00' }],
  ])('refuses %s and says so', (_label, from, command) => {
    const outcome = applyCommand(from, command)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return

    expect(outcome.alreadyApplied).toBe(false)
    expect(outcome.reason).toBeTruthy()
  })

  it('will not record a late Alloggiati failure over an acknowledgement', () => {
    // The authority already accepted the submission. A failure arriving
    // afterwards is about a different attempt, and writing it would erase the
    // acceptance — which is the one thing E2.3's audit trail must not lose.
    const outcome = applyCommand(state({ alloggiati: 'acknowledged' }), {
      type: 'alloggiati.fail',
    })

    expect(outcome).toMatchObject({ ok: false, alreadyApplied: false })
  })
})

describe('the orderings real guests produce', () => {
  it('accepts a pre-check-in nobody invited', () => {
    // A guest who followed the link in their confirmation email rather than
    // waiting for the T-48h invitation has done exactly what we wanted.
    // Refusing because we had not asked yet would be the machine enforcing its
    // own paperwork against the guest.
    const outcome = applyCommand(state(), {
      type: 'precheckin.submit',
      documentsCaptured: false,
    })

    expect(outcome.ok).toBe(true)
  })

  it('lets a guest state an arrival time before anything else', () => {
    const outcome = applyCommand(state(), { type: 'arrival.expect', time: '18:30' })

    expect(outcome.ok && outcome.next.expectedArrivalTime).toBe('18:30')
  })

  it('lets a delayed guest restate their arrival time', () => {
    const first = run(state(), { type: 'arrival.expect', time: '18:00' })
    const outcome = applyCommand(first, { type: 'arrival.expect', time: '22:15' })

    // Not a no-op: the second answer is the true one, and the property needs it.
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.next.expectedArrivalTime).toBe('22:15')
  })

  it('will not let a guest restate arrival after they have arrived', () => {
    const outcome = applyCommand(state({ arrival: 'confirmed' }), {
      type: 'arrival.expect',
      time: '23:00',
    })

    expect(outcome.ok).toBe(false)
  })

  it('carries documents along when they arrive with the form', () => {
    const outcome = applyCommand(state(), {
      type: 'precheckin.submit',
      documentsCaptured: true,
    })

    // One command, two dimensions — because it is one thing the guest did, and
    // recording it as two would make the log claim two separate visits.
    expect(outcome.ok && outcome.next.documents).toBe('captured')
  })

  it('does not undo a validation when the form is resubmitted', () => {
    const from = state({ precheckin: 'invited', documents: 'validated' })
    const outcome = applyCommand(from, { type: 'precheckin.submit', documentsCaptured: true })

    expect(outcome.ok && outcome.next.documents).toBe('validated')
  })

  it('always allows a deletion, whatever state the documents are in', () => {
    // E2.4 is a person's right to have their document destroyed. A machine that
    // refused because the paperwork had not reached the expected step would be
    // refusing the wrong thing.
    for (const documents of ['pending', 'captured', 'validated'] as const) {
      expect(applyCommand(state({ documents }), { type: 'documents.delete' }).ok).toBe(true)
    }
  })

  it('retries Alloggiati after a failure', () => {
    const end = run(
      state({ documents: 'validated' }),
      { type: 'alloggiati.stage' },
      { type: 'alloggiati.submit' },
      { type: 'alloggiati.fail' },
      { type: 'alloggiati.submit' },
      { type: 'alloggiati.acknowledge' },
    )

    expect(end.alloggiati).toBe('acknowledged')
  })
})

describe('journeyProgress', () => {
  it('is zero at the start and one at the end', () => {
    expect(journeyProgress(INITIAL_JOURNEY)).toBe(0)
    expect(
      journeyProgress(
        state({
          precheckin: 'submitted',
          documents: 'deleted',
          arrival: 'confirmed',
          departure: 'closed',
        }),
      ),
    ).toBe(1)
  })

  it('counts a deleted document as done, not as undone', () => {
    // Deletion is the *end* of the document's life under E2.4, not a regression
    // to pending. A progress bar that went backwards after we did the right
    // thing would be reporting our own compliance as a problem.
    const validated = journeyProgress(state({ documents: 'validated' }))
    const deleted = journeyProgress(state({ documents: 'deleted' }))

    expect(deleted).toBe(validated)
  })
})

describe('outstandingForGuest', () => {
  it('lists everything at the start', () => {
    expect(outstandingForGuest(INITIAL_JOURNEY)).toEqual(['details', 'documents', 'arrival'])
  })

  it('is empty once the guest has done their part', () => {
    expect(
      outstandingForGuest(
        state({ precheckin: 'submitted', documents: 'captured', arrival: 'expected' }),
      ),
    ).toEqual([])
  })

  it('does not ask for documents again after they are deleted', () => {
    expect(
      outstandingForGuest(
        state({ precheckin: 'submitted', documents: 'deleted', arrival: 'expected' }),
      ),
    ).toEqual([])
  })
})
