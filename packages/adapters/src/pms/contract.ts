import { describe, expect, it } from 'vitest'
import { PmsAdapterError, type PmsAdapter } from '@bookone/core/adapters'

/**
 * The shared `PmsAdapter` contract.
 *
 * Every implementation runs this same suite. Passing it is the precondition for
 * replacing the mock with the real Ericsoft adapter (ADR-008) — the swap is not
 * a judgement call about whether the connector "looks right", it is this file
 * going green against it.
 *
 * What belongs here: behaviour the sync engine relies on regardless of who is
 * behind the interface. What does not: anything about fixture *values*, which
 * are the mock's business and will differ for a real hotel.
 *
 * Written as a callable rather than a plain test file so both implementations
 * import the identical assertions. Two copies would diverge, and the copy that
 * diverged would be the real one — which is the one that matters.
 */
export function describePmsAdapterContract(
  name: string,
  createAdapter: () => PmsAdapter | Promise<PmsAdapter>,
  options: { propertyId?: string } = {},
): void {
  const propertyId = options.propertyId ?? 'contract-property'

  const reflectInput = {
    reservationId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
    propertyId,
    roomTypeCode: 'DBL',
    arrivalDate: '2026-09-10',
    departureDate: '2026-09-13',
    guestName: 'Contract Guest',
    guestEmail: 'guest@example.test',
    totalCents: 36000,
    currency: 'EUR',
  }

  describe(`PmsAdapter contract — ${name}`, () => {
    it('names the system it speaks for', async () => {
      const adapter = await createAdapter()

      // `external_refs.system` is keyed on this; an empty or shifting value
      // orphans every reference ever written under it (ADR-001).
      expect(adapter.system).toMatch(/^[a-z][a-z0-9_-]*$/)
    })

    describe('getAvailability', () => {
      it('returns one entry per room type per night', async () => {
        const adapter = await createAdapter()

        const result = await adapter.getAvailability({
          propertyId,
          from: '2026-09-10',
          to: '2026-09-13',
          roomTypeCode: 'DBL',
        })

        // Three nights: the 10th, 11th and 12th. A stay departing on the 13th
        // does not occupy the 13th, and an adapter that returns four entries
        // will overcount occupancy everywhere downstream.
        expect(result.entries.map((entry) => entry.date)).toEqual([
          '2026-09-10',
          '2026-09-11',
          '2026-09-12',
        ])
      })

      it('reports when the data was true', async () => {
        const adapter = await createAdapter()

        const result = await adapter.getAvailability({
          propertyId,
          from: '2026-09-10',
          to: '2026-09-11',
        })

        // PRD A2: displayed availability is never staler than five minutes.
        // The surface cannot enforce that without being told when the source
        // produced the data — a missing timestamp makes the rule unenforceable.
        expect(result.fetchedAt).toBeInstanceOf(Date)
        expect(Number.isNaN(result.fetchedAt.getTime())).toBe(false)
      })

      it('carries a currency on every price', async () => {
        const adapter = await createAdapter()

        const result = await adapter.getAvailability({
          propertyId,
          from: '2026-09-10',
          to: '2026-09-12',
        })

        for (const entry of result.entries) {
          expect(entry.currency).toMatch(/^[A-Z]{3}$/)
          expect(Number.isInteger(entry.priceCents)).toBe(true)
          expect(entry.priceCents).toBeGreaterThanOrEqual(0)
        }
      })

      it('returns an empty list rather than throwing for a zero-night range', async () => {
        const adapter = await createAdapter()

        const result = await adapter.getAvailability({
          propertyId,
          from: '2026-09-10',
          to: '2026-09-10',
        })

        expect(result.entries).toEqual([])
      })
    })

    describe('reflectReservation', () => {
      it('returns a reference naming its own system', async () => {
        const adapter = await createAdapter()

        const reference = await adapter.reflectReservation(reflectInput)

        expect(reference.system).toBe(adapter.system)
        expect(reference.externalId.length).toBeGreaterThan(0)
      })

      it('is idempotent on the reservation id', async () => {
        const adapter = await createAdapter()

        const first = await adapter.reflectReservation(reflectInput)
        const second = await adapter.reflectReservation(reflectInput)

        // The single most important assertion in this file. The reflection job
        // retries on timeout, and a non-idempotent adapter turns one guest's
        // booking into two rooms held in a real hotel.
        expect(second).toEqual(first)
      })

      it('gives different reservations different references', async () => {
        const adapter = await createAdapter()

        const first = await adapter.reflectReservation(reflectInput)
        const second = await adapter.reflectReservation({
          ...reflectInput,
          reservationId: '99887766-5544-3322-1100-aabbccddeeff',
        })

        expect(second.externalId).not.toBe(first.externalId)
      })

      it('makes the reflected reservation readable back', async () => {
        const adapter = await createAdapter()

        const reference = await adapter.reflectReservation(reflectInput)
        const found = await adapter.getReservation(propertyId, reference.externalId)

        expect(found).not.toBeNull()
        expect(found?.arrivalDate).toBe(reflectInput.arrivalDate)
        expect(found?.departureDate).toBe(reflectInput.departureDate)
      })
    })

    describe('getReservation', () => {
      it('returns null for something that is not there', async () => {
        const adapter = await createAdapter()

        // Null, not a throw: "no such reservation" is an ordinary answer during
        // reconciliation, and an exception there would turn a routine
        // discrepancy into a failed nightly run.
        await expect(adapter.getReservation(propertyId, 'does-not-exist')).resolves.toBeNull()
      })
    })

    describe('postCheckIn', () => {
      it('accepts a check-in for a known reservation', async () => {
        const adapter = await createAdapter()
        const reference = await adapter.reflectReservation(reflectInput)

        await expect(
          adapter.postCheckIn(propertyId, reference.externalId, new Date('2026-09-10T15:00:00Z')),
        ).resolves.toBeUndefined()
      })

      it('throws a non-retryable not_found for an unknown reservation', async () => {
        const adapter = await createAdapter()

        try {
          await adapter.postCheckIn(propertyId, 'does-not-exist', new Date())
          expect.unreachable('postCheckIn should reject an unknown reservation')
        } catch (error) {
          expect(error).toBeInstanceOf(PmsAdapterError)
          const failure = error as PmsAdapterError
          expect(failure.code).toBe('not_found')
          // Retrying cannot conjure the reservation. Marked retryable, this
          // would burn the queue against a call that can never succeed.
          expect(failure.retryable).toBe(false)
        }
      })
    })

    describe('healthCheck', () => {
      it('reports status with a timestamp', async () => {
        const adapter = await createAdapter()

        const health = await adapter.healthCheck()

        expect(typeof health.healthy).toBe('boolean')
        expect(health.checkedAt).toBeInstanceOf(Date)
      })

      it('never throws — an unhealthy connector still has to report', async () => {
        const adapter = await createAdapter()

        // The console shows connector status honestly (03 §8). A health check
        // that throws when things are broken shows nothing exactly when the
        // owner needs to know something is wrong.
        await expect(adapter.healthCheck()).resolves.toBeDefined()
      })
    })
  })
}
