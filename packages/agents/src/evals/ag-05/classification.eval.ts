import { describe, expect, it } from 'vitest'
import { classifyDiscrepancyTool } from '../../tools'

/**
 * AG-05 golden set — discrepancy classification.
 *
 * Every agent has an eval set *before* it has production traffic (06 §1.5).
 * This one runs in CI as the `evals` gate, and it grows from reviewed
 * production failures rather than from imagination.
 *
 * The cases below are the ones that matter operationally: the classes exist so
 * that one real disagreement is never buried under a hundred expected ones. An
 * agent that called every difference `logic` would technically be safe and
 * would make the exceptions inbox useless, which is why "does not
 * over-escalate" is asserted as explicitly as "does not under-escalate".
 */

const context = { propertyId: 'p1' }

const ours = {
  arrivalDate: '2026-09-10',
  departureDate: '2026-09-13',
  totalCents: 36000,
  roomTypeCode: 'DBL',
}

const theirs = {
  externalId: 'ERI-000001',
  roomTypeCode: 'DBL',
  arrivalDate: '2026-09-10',
  departureDate: '2026-09-13',
  guestName: 'Guest',
  status: 'confirmed',
  totalCents: 36000,
  currency: 'EUR',
}

async function classify(theirOverrides: Partial<typeof theirs>) {
  const result = await classifyDiscrepancyTool.run(context, {
    ours,
    theirs: { ...theirs, ...theirOverrides },
  })

  return result.output as { class: string; divergences: { field: string; class: string }[] }
}

describe('AG-05 · agreement', () => {
  it('finds nothing when the two sides match', async () => {
    const output = await classify({})

    expect(output.class).toBe('none')
    expect(output.divergences).toEqual([])
  })

  it('ignores a total the PMS does not track', async () => {
    // Not a disagreement about money — the PMS simply does not hold one.
    // Reporting it would train owners to ignore the inbox.
    const result = await classifyDiscrepancyTool.run(context, {
      ours,
      theirs: { ...theirs, totalCents: undefined },
    })

    expect((result.output as { class: string }).class).toBe('none')
  })
})

describe('AG-05 · rounding', () => {
  it.each([1, 50, 100])('calls a %d-cent difference rounding', async (cents) => {
    const output = await classify({ totalCents: 36000 + cents })

    expect(output.class).toBe('rounding')
  })

  it('stops calling it rounding once it is more than a euro', async () => {
    // The boundary is the whole point of the class. Too loose and a real
    // pricing error is filed as noise.
    const output = await classify({ totalCents: 36000 + 101 })

    expect(output.class).toBe('logic')
  })

  it('treats a difference in either direction the same', async () => {
    expect((await classify({ totalCents: 35_950 })).class).toBe('rounding')
    expect((await classify({ totalCents: 36_050 })).class).toBe('rounding')
  })
})

describe('AG-05 · timezone', () => {
  it('calls a one-day arrival shift a timezone artefact', async () => {
    const output = await classify({ arrivalDate: '2026-09-09' })

    expect(output.class).toBe('tz')
  })

  it('calls a one-day departure shift a timezone artefact', async () => {
    const output = await classify({ departureDate: '2026-09-14' })

    expect(output.class).toBe('tz')
  })

  it('does not excuse a two-day shift', async () => {
    // Two days is not a zone. Somebody changed the stay in one system.
    const output = await classify({ arrivalDate: '2026-09-08' })

    expect(output.class).toBe('logic')
  })
})

describe('AG-05 · logic', () => {
  it('never excuses a different room type', async () => {
    // A guest moved in one system and not the other. There is no arithmetic
    // that makes this benign.
    const output = await classify({ roomTypeCode: 'SGL' })

    expect(output.class).toBe('logic')
  })

  it('escalates when a benign difference sits beside a real one', async () => {
    // Worst class wins. The failure this prevents: a room change filed as
    // "rounding" because a one-cent difference was also present.
    const output = await classify({ totalCents: 36_001, roomTypeCode: 'SGL' })

    expect(output.class).toBe('logic')
    expect(output.divergences).toHaveLength(2)
  })
})

describe('AG-05 · reporting', () => {
  it('reports full confidence, because this is arithmetic', async () => {
    // A hedged number for a deterministic comparison would make the tier
    // threshold meaningless for every agent that comes after this one.
    const result = await classifyDiscrepancyTool.run(context, { ours, theirs })

    expect((result.output as { confidence: number }).confidence).toBe(1)
  })

  it('refuses rather than guesses when an input is missing', async () => {
    const result = await classifyDiscrepancyTool.run(context, { ours })

    expect(result.ok).toBe(false)
  })
})
