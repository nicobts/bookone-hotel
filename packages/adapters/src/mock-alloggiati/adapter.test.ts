import { describe, expect, it } from 'vitest'
import { RECORD_WIDTH } from '@bookone/core/alloggiati'
import { MockAlloggiatiAdapter } from './adapter'
import { describeAlloggiatiContract } from '../alloggiati/contract'

describeAlloggiatiContract('MockAlloggiatiAdapter', () => new MockAlloggiatiAdapter())

const payload = ['X'.repeat(RECORD_WIDTH), 'Y'.repeat(RECORD_WIDTH)].join('\r\n')
const input = { propertyId: 'p1', reservationId: 'r1', payload, guestCount: 2 }

describe('MockAlloggiatiAdapter — simulation behaviour', () => {
  it('declares itself simulated', () => {
    // The one property the staging decision rests on. If this were ever false,
    // the console would stop telling an owner nothing was actually filed.
    expect(new MockAlloggiatiAdapter().simulated).toBe(true)
  })

  it('acknowledges on upload by default, like Alloggiati Web', async () => {
    const adapter = new MockAlloggiatiAdapter()

    const result = await adapter.submit(input)

    expect(result.receipt).toBeDefined()
  })

  it('can queue instead, like an intermediary', async () => {
    // The channel is not chosen yet, so the deletion job has to be correct for
    // both shapes. This is how the queued one gets exercised.
    const adapter = new MockAlloggiatiAdapter({ pendingChecks: 2 })

    const submitted = await adapter.submit(input)
    expect(submitted.receipt).toBeUndefined()

    const first = await adapter.checkAcknowledgement({
      propertyId: 'p1',
      reference: submitted.reference,
    })
    expect(first.status).toBe('pending')

    await adapter.checkAcknowledgement({ propertyId: 'p1', reference: submitted.reference })

    const third = await adapter.checkAcknowledgement({
      propertyId: 'p1',
      reference: submitted.reference,
    })
    expect(third.status).toBe('acknowledged')
  })

  it('ties the receipt to the exact bytes transmitted', async () => {
    const adapter = new MockAlloggiatiAdapter()

    const result = await adapter.submit(input)

    // A receipt that cannot be tied to a payload settles no dispute about what
    // was filed.
    expect(result.receipt?.payloadChecksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never reissues a reference', async () => {
    const a = new MockAlloggiatiAdapter()
    const b = new MockAlloggiatiAdapter()

    const first = await a.submit(input)
    const second = await b.submit(input)

    // A real channel never reissues one, and two adapters sharing a database
    // collided on `external_refs` the last time a mock did.
    expect(first.reference).not.toBe(second.reference)
  })

  it('fails a counted number of times, then succeeds', async () => {
    const adapter = new MockAlloggiatiAdapter({
      failures: [{ on: 'submit', code: 'unavailable', times: 2 }],
    })

    await expect(adapter.submit(input)).rejects.toMatchObject({ retryable: true })
    await expect(adapter.submit(input)).rejects.toMatchObject({ retryable: true })
    await expect(adapter.submit(input)).resolves.toMatchObject({ reference: expect.any(String) })
  })

  it('marks a rejection as not retryable', async () => {
    const adapter = new MockAlloggiatiAdapter({
      failures: [{ on: 'submit', code: 'rejected', times: 1 }],
    })

    // A rejected payload will be rejected again. Retrying it is how a queue
    // spends a day filing the same broken declaration.
    await expect(adapter.submit(input)).rejects.toMatchObject({ retryable: false })
  })
})
