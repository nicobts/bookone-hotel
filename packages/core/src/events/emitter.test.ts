import { describe, expect, it, vi } from 'vitest'
import { emit, emitMany } from './emitter'
import { agentActor, systemActor, userActor } from './actor'

/**
 * The emitter's own logic — validation and mapping.
 *
 * The database round trip is covered by the isolation suite, which writes a
 * real event through a real policy (`session.test.ts`). Repeating that here
 * would need Postgres to assert something already asserted; what is worth
 * testing at this level is what this file decides on its own.
 */

/** Minimal stand-in for a Drizzle transaction: records what it was handed. */
function stubTx(returning: { id: bigint }[] = [{ id: 1n }]) {
  // Typed to take the argument so `values.mock.calls[0][0]` is inspectable —
  // an argless vi.fn() gives a zero-length tuple and nothing to assert on.
  const values = vi.fn((_row: unknown) => ({ returning: vi.fn(async () => returning) }))
  const insert = vi.fn((_table: unknown) => ({ values }))

  // The shape below is what emit() actually calls, not the full Drizzle API.
  return { tx: { insert } as never, insert, values }
}

const base = {
  propertyId: 'p1',
  entityType: 'reservation',
  eventType: 'reservation.confirmed',
  origin: 'platform' as const,
  actor: userActor('u1'),
}

describe('emit', () => {
  it('writes actor and origin on every row (binding rule 2)', async () => {
    const { tx, values } = stubTx()

    await emit(tx, { ...base, entityId: 'r1', payload: { total: 12000 } })

    expect(values).toHaveBeenCalledWith({
      propertyId: 'p1',
      entityType: 'reservation',
      entityId: 'r1',
      eventType: 'reservation.confirmed',
      origin: 'platform',
      actor: 'user:u1',
      payload: { total: 12000 },
    })
  })

  it('returns the new id so an agent run can link to its trigger', async () => {
    const { tx } = stubTx([{ id: 42n }])

    await expect(emit(tx, base)).resolves.toBe(42n)
  })

  it('defaults payload to an empty object rather than null', async () => {
    const { tx, values } = stubTx()

    await emit(tx, base)

    expect(values.mock.calls[0]?.[0]).toMatchObject({ payload: {}, entityId: null })
  })

  it('records an agent actor with the prefix the audit trail queries on', async () => {
    const { tx, values } = stubTx()

    await emit(tx, { ...base, actor: agentActor('AG-05'), origin: 'reconciliation' })

    expect(values.mock.calls[0]?.[0]).toMatchObject({
      actor: 'agent:AG-05',
      origin: 'reconciliation',
    })
  })

  it('accepts the system actor for jobs with no human behind them', async () => {
    const { tx, values } = stubTx()

    await emit(tx, { ...base, actor: systemActor, origin: 'sync' })

    expect(values.mock.calls[0]?.[0]).toMatchObject({ actor: 'system', origin: 'sync' })
  })

  it('throws if the insert returns nothing', async () => {
    const { tx } = stubTx([])

    await expect(emit(tx, base)).rejects.toThrow(/returned no row/)
  })
})

describe('event type validation', () => {
  it.each([
    'reservation.confirmed',
    'documents.uploaded',
    'journey.precheckin-invited',
    'rate_snapshot.refreshed',
    'stay.closed',
  ])('accepts %s', async (eventType) => {
    const { tx } = stubTx()
    await expect(emit(tx, { ...base, eventType })).resolves.toBe(1n)
  })

  it.each([
    ['Reservation.Confirmed', 'capitals'],
    ['reservation', 'no verb'],
    ['reservation.', 'empty verb'],
    ['.confirmed', 'empty noun'],
    ['reservation confirmed', 'a space'],
    ['reservation..confirmed', 'a double dot'],
    ['2reservation.confirmed', 'a leading digit'],
  ])('rejects %s (%s)', async (eventType) => {
    // One `reservation.Confirm` among ten thousand `reservation.confirmed`
    // rows fails nothing — it quietly makes a count wrong, and the count is
    // what someone gets invoiced from (D14).
    const { tx } = stubTx()
    await expect(emit(tx, { ...base, eventType })).rejects.toThrow(/Invalid event type/)
  })

  it('validates before writing anything', async () => {
    const { tx, insert } = stubTx()

    await expect(emit(tx, { ...base, eventType: 'BAD' })).rejects.toThrow()
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('emitMany', () => {
  it('writes nothing and touches no connection for an empty list', async () => {
    const { tx, insert } = stubTx()

    await expect(emitMany(tx, [])).resolves.toEqual([])
    expect(insert).not.toHaveBeenCalled()
  })

  it('writes every event in one statement', async () => {
    const { tx, values, insert } = stubTx([{ id: 1n }, { id: 2n }])

    const ids = await emitMany(tx, [base, { ...base, eventType: 'reservation.cancelled' }])

    expect(insert).toHaveBeenCalledTimes(1)
    expect(values.mock.calls[0]?.[0]).toHaveLength(2)
    expect(ids).toEqual([1n, 2n])
  })

  it('rejects the whole batch if any event type is invalid', async () => {
    // Partial writes here would leave the log describing half a mutation.
    const { tx, insert } = stubTx()

    await expect(emitMany(tx, [base, { ...base, eventType: 'BAD' }])).rejects.toThrow()
    expect(insert).not.toHaveBeenCalled()
  })
})
