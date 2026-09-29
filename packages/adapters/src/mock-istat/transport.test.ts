import { describe, expect, it } from 'vitest'
import { IstatTransportError } from '@bookone/core/compliance'
import { describeIstatTransportContract } from '../istat/contract'
import { MockIstatTransport } from './transport'

describeIstatTransportContract('MockIstatTransport', () => new MockIstatTransport())

describe('MockIstatTransport', () => {
  const movement = {
    day: '2026-10-01',
    byOrigin: {},
    totals: { arrivals: 0, departures: 0, presences: 0 },
    roomsOccupied: 0,
    byCitizenship: 0,
    unknownIn: [],
  }

  it('fails as told: an outage is retryable, a refusal is not', async () => {
    const transport = new MockIstatTransport()
    transport.failNext('unavailable', 2)
    transport.failNext('rejected')
    for (const retryable of [true, true, false]) {
      const error = await transport
        .submitDay({ propertyId: 'p', day: movement.day, movement })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(IstatTransportError)
      expect((error as IstatTransportError).retryable).toBe(retryable)
    }
    await expect(
      transport.submitDay({ propertyId: 'p', day: movement.day, movement }),
    ).resolves.toHaveProperty('reference')
  })
})
