import { describe, expect, it } from 'vitest'
import { welcomePayload } from '../arrival'
import { shouldConfirmArrival, DOOR_ADAPTER_REQUIREMENTS, type DoorEvent } from '../door'
import { readBusinessHours } from '../../concierge/facts'

/**
 * Arrival and departure, the parts that do not need a database (E3.1, E4.1).
 *
 * The interesting behaviour here is what happens when a property has *not*
 * filled something in, because that is the normal state of a ten-room hotel on
 * a Tuesday. Every one of these asserts an absence rather than a fallback:
 * binding rule 7 means a missing wifi password produces a message with no wifi
 * line, never a plausible one.
 */

describe('welcomePayload', () => {
  const stay = {
    propertyName: 'Hotel Sonja',
    guestName: 'Rosa Weber',
    roomName: { en: 'Double', it: 'Doppia' },
    arrivalDate: '2026-09-03',
    departureDate: '2026-09-06',
    propertySettings: {
      arrival: {
        accessNote: 'The front door code is on the keypad card.',
        wifiName: 'Sonja-Guest',
        wifiPassword: 'buonanotte',
      },
    },
  }

  it('carries what the property recorded', () => {
    const facts = welcomePayload(stay, 'https://example.test/stay/abc')

    expect(facts.accessNote).toBe('The front door code is on the keypad card.')
    expect(facts.wifiName).toBe('Sonja-Guest')
    expect(facts.stayUrl).toBe('https://example.test/stay/abc')
  })

  it('leaves out what the property has not recorded', () => {
    const facts = welcomePayload({ ...stay, propertySettings: {} }, null)

    // Null, so the template omits the line. A guessed door code is a guest
    // locked out at midnight — the single most expensive thing this file can
    // get wrong.
    expect(facts.accessNote).toBeNull()
    expect(facts.wifiName).toBeNull()
    expect(facts.wifiPassword).toBeNull()
  })

  it('treats a blank setting as absent rather than sending an empty line', () => {
    const facts = welcomePayload(
      { ...stay, propertySettings: { arrival: { accessNote: '   ' } } },
      null,
    )

    expect(facts.accessNote).toBeNull()
  })

  it('survives settings that are not an object at all', () => {
    for (const settings of [null, undefined, 'nonsense', 42]) {
      expect(() => welcomePayload({ ...stay, propertySettings: settings }, null)).not.toThrow()
    }
  })

  it('reads a room name out of the localised object', () => {
    expect(welcomePayload(stay, null).roomName).toBe('Double')
  })

  it('reads a room name that was stored as a plain string', () => {
    expect(welcomePayload({ ...stay, roomName: 'Suite' }, null).roomName).toBe('Suite')
  })

  it('has no room name when the reservation has no room type', () => {
    expect(welcomePayload({ ...stay, roomName: null }, null).roomName).toBeNull()
  })
})

describe('readBusinessHours', () => {
  it('reads the property stated window', () => {
    expect(readBusinessHours({ businessHours: '08:00–20:00' })).toBe('08:00–20:00')
  })

  it('is null when the property has not said', () => {
    // The escalation phrase then omits the sentence entirely. "Someone will
    // reply within the hour", said by software with no idea, is a small lie told
    // at the moment a guest most needed a true one.
    expect(readBusinessHours({})).toBeNull()
    expect(readBusinessHours(null)).toBeNull()
    expect(readBusinessHours({ businessHours: '  ' })).toBeNull()
  })
})

describe('shouldConfirmArrival', () => {
  const event = (credential: DoorEvent['credential']): DoorEvent => ({
    propertyId: 'p1',
    reservationId: 'r1',
    deviceRef: 'lock-4',
    at: new Date('2026-09-03T15:00:00Z'),
    credential,
  })

  it('confirms an arrival when the guest own credential opened the door', () => {
    expect(shouldConfirmArrival(event('guest'))).toBe(true)
  })

  it('does not confirm an arrival for a staff credential', () => {
    /*
     * A cleaner opening a room at 11:00 would otherwise check in a guest who is
     * still on a train: it fires the Alloggiati filing for a party that has not
     * been registered and sends a welcome to somebody two hours away.
     *
     * Asserted before any vendor exists, because the rule belongs to the
     * journey rather than to a lock.
     */
    expect(shouldConfirmArrival(event('staff'))).toBe(false)
  })

  it('does not confirm an arrival when the vendor cannot say who it was', () => {
    expect(shouldConfirmArrival(event('unknown'))).toBe(false)
  })
})

describe('the door adapter checklist', () => {
  it('records what a vendor implementation has to prove', () => {
    // A checklist rather than a contract suite because there is nothing to run
    // one against yet. The suite gets written from this list when a vendor is
    // chosen — from here, not from the vendor's documentation.
    expect(DOOR_ADAPTER_REQUIREMENTS.length).toBeGreaterThanOrEqual(4)
  })
})
