import { describe, expect, it } from 'vitest'
import { PmsAdapterError } from '@bookone/core/adapters'
import { describePmsAdapterContract } from '../pms/contract'
import { MockEricsoftAdapter } from './adapter'

// The shared contract. The real Ericsoft adapter runs this identical suite
// before it is allowed to replace the mock (ADR-008).
describePmsAdapterContract('MockEricsoftAdapter', () => new MockEricsoftAdapter())

describe('determinism', () => {
  it('returns the same availability for the same query', async () => {
    // A mock that varies between runs produces a flaky suite, and a flaky suite
    // gets skipped. Prices and counts derive from a hash of the inputs, not
    // from a clock or a random source.
    const query = { propertyId: 'p1', from: '2026-09-10', to: '2026-09-13' }

    const first = await new MockEricsoftAdapter().getAvailability(query)
    const second = await new MockEricsoftAdapter().getAvailability(query)

    expect(second.entries).toEqual(first.entries)
  })

  it('gives different properties different availability', async () => {
    const adapter = new MockEricsoftAdapter()
    const range = { from: '2026-09-10', to: '2026-09-13' }

    const a = await adapter.getAvailability({ propertyId: 'p1', ...range })
    const b = await adapter.getAvailability({ propertyId: 'p2', ...range })

    expect(b.entries).not.toEqual(a.entries)
  })

  it('reaches sold out somewhere in a long enough range', async () => {
    // The exception paths need a zero to exist. A fixture that is always
    // available cannot exercise the "no rooms" branch of the booking surface.
    const result = await new MockEricsoftAdapter().getAvailability({
      propertyId: 'p1',
      from: '2026-09-01',
      to: '2026-10-01',
    })

    expect(result.entries.some((entry) => entry.available === 0)).toBe(true)
  })
})

describe('failure injection', () => {
  it('fails the configured number of times, then succeeds', async () => {
    const adapter = new MockEricsoftAdapter({
      failures: [{ on: 'reflectReservation', code: 'unavailable', times: 2 }],
    })

    const input = {
      reservationId: 'r1',
      propertyId: 'p1',
      roomTypeCode: 'DBL',
      arrivalDate: '2026-09-10',
      departureDate: '2026-09-11',
      guestName: 'Guest',
    }

    // A count rather than a probability is what makes retry behaviour testable:
    // "fails twice then succeeds" is a scenario a test can assert on.
    await expect(adapter.reflectReservation(input)).rejects.toThrow(PmsAdapterError)
    await expect(adapter.reflectReservation(input)).rejects.toThrow(PmsAdapterError)
    await expect(adapter.reflectReservation(input)).resolves.toMatchObject({ system: 'ericsoft' })
    expect(adapter.pendingFailures()).toBe(0)
  })

  it('marks transport failures retryable and rejections not', async () => {
    // The job queue reads this field. Getting it wrong in either direction is
    // expensive: a retryable error marked permanent drops a reservation, and a
    // permanent one marked retryable burns the queue forever.
    const cases = [
      ['unavailable', true],
      ['throttled', true],
      ['unauthorized', false],
      ['rejected', false],
    ] as const

    for (const [code, retryable] of cases) {
      const adapter = new MockEricsoftAdapter({ failures: [{ on: 'any', code, times: 1 }] })

      await adapter
        .getAvailability({ propertyId: 'p1', from: '2026-09-10', to: '2026-09-11' })
        .then(() => expect.unreachable(`${code} should have thrown`))
        .catch((error: PmsAdapterError) => {
          expect(error.code).toBe(code)
          expect(error.retryable).toBe(retryable)
        })
    }
  })

  it('scopes a failure to the method it names', async () => {
    const adapter = new MockEricsoftAdapter({
      failures: [{ on: 'postCheckIn', code: 'unavailable', times: 1 }],
    })

    await expect(
      adapter.getAvailability({ propertyId: 'p1', from: '2026-09-10', to: '2026-09-11' }),
    ).resolves.toBeDefined()
    await expect(adapter.postCheckIn('p1', 'x', new Date())).rejects.toThrow(PmsAdapterError)
  })

  it('never recovers when times is Infinity', async () => {
    const adapter = new MockEricsoftAdapter({
      failures: [{ on: 'any', code: 'unauthorized', times: Number.POSITIVE_INFINITY }],
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(adapter.healthCheck()).resolves.toBeDefined()
      await expect(
        adapter.getAvailability({ propertyId: 'p1', from: '2026-09-10', to: '2026-09-11' }),
      ).rejects.toThrow(/unauthorized/)
    }
  })

  it('reports unhealthy while failures are queued', async () => {
    const adapter = new MockEricsoftAdapter({
      failures: [{ on: 'any', code: 'unavailable', times: 1 }],
    })

    const before = await adapter.healthCheck()
    expect(before.healthy).toBe(false)
    expect(before.message).toContain('unavailable')

    await adapter
      .getAvailability({ propertyId: 'p1', from: '2026-09-10', to: '2026-09-11' })
      .catch(() => undefined)

    expect((await adapter.healthCheck()).healthy).toBe(true)
  })
})

describe('idempotency under failure', () => {
  it('does not double-book when a retry follows a failure', async () => {
    // The scenario the whole design exists for: reflect times out, the job
    // retries, and the hotel must end up with one booking rather than two.
    const adapter = new MockEricsoftAdapter({
      failures: [{ on: 'reflectReservation', code: 'unavailable', times: 1 }],
    })

    const input = {
      reservationId: 'r-retry',
      propertyId: 'p1',
      roomTypeCode: 'DBL',
      arrivalDate: '2026-09-10',
      departureDate: '2026-09-11',
      guestName: 'Guest',
    }

    await expect(adapter.reflectReservation(input)).rejects.toThrow()
    const first = await adapter.reflectReservation(input)
    const second = await adapter.reflectReservation(input)

    expect(second.externalId).toBe(first.externalId)
  })
})

describe('stale availability', () => {
  it('can report data older than the five-minute rule allows', async () => {
    // PRD A2 says displayed availability is never staler than five minutes.
    // That rule needs a failing case to be testable at all.
    const now = new Date('2026-09-01T08:00:00Z')
    const adapter = new MockEricsoftAdapter({
      availabilityAgeSeconds: 600,
      now: () => now,
    })

    const result = await adapter.getAvailability({
      propertyId: 'p1',
      from: '2026-09-10',
      to: '2026-09-11',
    })

    expect(now.getTime() - result.fetchedAt.getTime()).toBe(600_000)
  })
})

describe('seeding', () => {
  it('exposes a reservation the connector already knows', async () => {
    const adapter = new MockEricsoftAdapter()

    adapter.seedReservation('p1', {
      externalId: 'ERI-EXISTING',
      roomTypeCode: 'SGL',
      arrivalDate: '2026-09-20',
      departureDate: '2026-09-22',
      guestName: 'Arrived Via PMS',
      status: 'confirmed',
    })

    const found = await adapter.getReservation('p1', 'ERI-EXISTING')

    expect(found?.guestName).toBe('Arrived Via PMS')
  })

  it('keeps properties apart', async () => {
    const adapter = new MockEricsoftAdapter()

    adapter.seedReservation('p1', {
      externalId: 'ERI-1',
      roomTypeCode: 'DBL',
      arrivalDate: '2026-09-20',
      departureDate: '2026-09-21',
      guestName: 'One',
      status: 'confirmed',
    })

    await expect(adapter.getReservation('p2', 'ERI-1')).resolves.toBeNull()
  })
})
