import { describe, expect, it } from 'vitest'
import { AlloggiatiError, RECORD_WIDTH, type AlloggiatiAdapter } from '@bookone/core/alloggiati'

/**
 * The shared `AlloggiatiAdapter` contract.
 *
 * Every implementation runs this same suite. Passing it is the precondition for
 * replacing the mock with a real channel — direct web service or certified
 * intermediary, whichever 04 §0 item 5 lands on. The swap is not a judgement
 * call about whether the integration looks right, it is this file going green.
 *
 * What belongs here: behaviour the staging and deletion paths rely on whatever
 * is behind the interface. What does not: anything about a channel's own
 * references, receipt shape, or transport.
 */
export function describeAlloggiatiContract(
  name: string,
  createAdapter: () => AlloggiatiAdapter | Promise<AlloggiatiAdapter>,
): void {
  const propertyId = 'contract-property'
  const reservationId = 'aa11bb22-cc33-dd44-ee55-ff6677889900'

  /** A syntactically valid file: two records of exactly the declared width. */
  const validPayload = ['X'.repeat(RECORD_WIDTH), 'Y'.repeat(RECORD_WIDTH)].join('\r\n')

  describe(`AlloggiatiAdapter contract — ${name}`, () => {
    it('names its channel and says whether it is simulated', async () => {
      const adapter = await createAdapter()

      expect(adapter.channel).toBeTruthy()
      // Not optional. The console reads this to avoid showing an owner a legal
      // obligation as discharged when nothing was filed, and an adapter that
      // leaves it undefined reads as falsy.
      expect(typeof adapter.simulated).toBe('boolean')
    })

    it('returns a reference for a filing it accepted', async () => {
      const adapter = await createAdapter()

      const result = await adapter.submit({
        propertyId,
        reservationId,
        payload: validPayload,
        guestCount: 2,
      })

      // The reference is how the acknowledgement is later chased. Without one
      // a queued channel could never be followed up.
      expect(result.reference).toBeTruthy()
    })

    it('rejects a file with no records', async () => {
      const adapter = await createAdapter()

      await expect(
        adapter.submit({ propertyId, reservationId, payload: '', guestCount: 0 }),
      ).rejects.toBeInstanceOf(AlloggiatiError)
    })

    it('rejects a record of the wrong width', async () => {
      const adapter = await createAdapter()

      // The authority validates on receipt, so every implementation must
      // surface this rather than accepting it — otherwise a builder bug reaches
      // a real property untested.
      await expect(
        adapter.submit({
          propertyId,
          reservationId,
          payload: 'too short',
          guestCount: 1,
        }),
      ).rejects.toBeInstanceOf(AlloggiatiError)
    })

    it('rejects a file whose record count disagrees with the declared guests', async () => {
      const adapter = await createAdapter()

      await expect(
        adapter.submit({
          propertyId,
          reservationId,
          payload: validPayload,
          guestCount: 5,
        }),
      ).rejects.toBeInstanceOf(AlloggiatiError)
    })

    it('does not acknowledge a reference it never issued', async () => {
      const adapter = await createAdapter()

      const result = await adapter.checkAcknowledgement({
        propertyId,
        reference: 'never-issued',
      })

      expect(result.status).toBe('failed')
    })

    it('will not acknowledge another property’s filing', async () => {
      const adapter = await createAdapter()
      const submitted = await adapter.submit({
        propertyId,
        reservationId,
        payload: validPayload,
        guestCount: 2,
      })

      // The sweep looks filings up by reference. Without scoping, one
      // property's acknowledgement could resolve another's submission — and
      // acknowledgement is what triggers destroying identity documents.
      const result = await adapter.checkAcknowledgement({
        propertyId: 'someone-else',
        reference: submitted.reference,
      })

      expect(result.status).toBe('failed')
    })

    it('reports its health without throwing', async () => {
      const adapter = await createAdapter()
      const health = await adapter.healthCheck()

      expect(typeof health.healthy).toBe('boolean')
      expect(health.checkedAt).toBeInstanceOf(Date)
    })
  })
}
