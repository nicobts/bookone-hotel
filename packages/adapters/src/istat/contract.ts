import { describe, expect, it } from 'vitest'
import type { DayMovement, IstatTransport } from '@bookone/core/compliance'

/**
 * The shared `IstatTransport` contract (WP1.3). Every transport runs it: the
 * mock today, WebTur's real route once the Regione's specification says what
 * it is. What the lifecycle relies on, whatever is behind the port.
 */
export function describeIstatTransportContract(
  name: string,
  createTransport: () => IstatTransport | Promise<IstatTransport>,
): void {
  const day = '2026-10-01'
  const movement = (presences: number): DayMovement => ({
    day,
    byOrigin: presences ? { FR: { arrivals: presences, departures: 0, presences } } : {},
    totals: { arrivals: presences, departures: 0, presences },
    roomsOccupied: presences ? 1 : 0,
    byCitizenship: 0,
    unknownIn: [],
  })

  describe(`IstatTransport contract — ${name}`, () => {
    it('names its channel and says whether it is simulated', async () => {
      const transport = await createTransport()
      expect(transport.channel).toBeTruthy()
      expect(typeof transport.simulated).toBe('boolean')
    })

    it('files a day, zero days included, and returns a reference', async () => {
      const transport = await createTransport()
      const { reference } = await transport.submitDay({
        propertyId: 'p1',
        day,
        movement: movement(0),
      })
      expect(reference).toBeTruthy()
      expect(await transport.readDay({ propertyId: 'p1', day })).toEqual(movement(0))
    })

    it('files the same day once: a second identical submit returns the same reference', async () => {
      const transport = await createTransport()
      const first = await transport.submitDay({ propertyId: 'p1', day, movement: movement(2) })
      const second = await transport.submitDay({ propertyId: 'p1', day, movement: movement(2) })
      expect(second.reference).toBe(first.reference)
    })

    it('replaces a day that changed, as a correction', async () => {
      const transport = await createTransport()
      const first = await transport.submitDay({ propertyId: 'p1', day, movement: movement(2) })
      const corrected = await transport.submitDay({ propertyId: 'p1', day, movement: movement(3) })
      expect(corrected.reference).not.toBe(first.reference)
      expect((await transport.readDay({ propertyId: 'p1', day }))?.totals.presences).toBe(3)
    })

    it('keeps each property’s days apart', async () => {
      const transport = await createTransport()
      await transport.submitDay({ propertyId: 'p1', day, movement: movement(2) })
      expect(await transport.readDay({ propertyId: 'p2', day })).toBeNull()
    })
  })
}
