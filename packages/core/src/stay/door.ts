/**
 * The door-event interface (E3.1, Rooms hook).
 *
 * **Nothing implements this.** BookOne Rooms is a separate module and a
 * separate commercial decision; what this file does is fix the shape of the
 * contract now, while the arrival path is being built, so that adding a lock
 * vendor later is an adapter rather than a change to the journey.
 *
 * ## Why declare a port with no implementation
 *
 * The same reason `postCheckIn` was on `PmsAdapter` from Sprint 2: writing the
 * third trigger's signature while building the first two is what proves the
 * journey really does accept three triggers. E3.1's acceptance criterion says
 * "door event **or** guest tap **or** staff tap", and a design that has only
 * ever been exercised by two of them tends to have grown a quiet assumption
 * about the pair.
 *
 * The one that mattered is `reservationId`. A lock reports a *room* opening,
 * and a room is not a stay: the same door opens for housekeeping, for the
 * previous guest's forgotten charger, and for the owner checking a radiator.
 * Resolving room-and-time to a reservation is the vendor adapter's job, and
 * making that explicit here is what stops the journey ever receiving "room 4
 * opened" as though it meant somebody had arrived.
 *
 * ## What a real implementation must satisfy
 *
 * A contract suite, like every other adapter in this codebase (ADR-008). It
 * does not exist yet because there is nothing to run it against; when a vendor
 * is chosen it is written first, and the four properties below are what it has
 * to assert. They are recorded now, while the reasoning is fresh.
 */

/** One door opening, already resolved to a stay by the vendor adapter. */
export interface DoorEvent {
  propertyId: string
  /**
   * The stay this opening belongs to.
   *
   * Resolved by the adapter, never by the journey. See the module header: a
   * lock knows about rooms, and only the vendor's own booking mapping knows
   * which stay was in that room at that minute.
   */
  reservationId: string
  /** The vendor's identifier for the lock. Attaches through `external_refs`. */
  deviceRef: string
  at: Date
  /**
   * Whose credential opened it, when the vendor can tell.
   *
   * `staff` and `unknown` must never confirm an arrival. A cleaner opening a
   * room at 11:00 would otherwise check in a guest who is still on a train, fire
   * the Alloggiati filing for a party that has not been registered, and send a
   * welcome message to somebody two hours away.
   */
  credential: 'guest' | 'staff' | 'unknown'
}

export interface DoorEventSource {
  /** `salto`, `nuki`, `ttlock`. Recorded on every event it produces. */
  readonly vendor: string

  /** True while no lock is connected. Read by the same surfaces that read `simulated` elsewhere. */
  readonly simulated: boolean

  /**
   * Verify and normalise an inbound webhook from the lock vendor.
   *
   * Returns null for an event we do not act on — a lock system emits battery
   * levels and firmware notices, and throwing on those turns normal traffic
   * into alerts. Throws on a payload that cannot be trusted.
   *
   * `async` deliberately, and this is the third time it is worth saying: a
   * method typed as returning a promise that throws *synchronously* escapes
   * every caller's `.catch()`. The payment and Alloggiati contract suites each
   * caught exactly that bug.
   */
  parseEvent(payload: string, signature: string | null): Promise<DoorEvent | null>

  healthCheck(): Promise<{ healthy: boolean; message?: string; checkedAt: Date }>
}

/**
 * Whether this door event should confirm an arrival.
 *
 * Pure, and separate from any vendor, because it is the rule the journey cares
 * about rather than a detail of a lock. Tested now so the answer is already
 * fixed when the first vendor arrives.
 */
export function shouldConfirmArrival(event: DoorEvent): boolean {
  return event.credential === 'guest'
}

/**
 * What a vendor adapter has to prove before it is allowed near the journey.
 *
 * Written as a checklist rather than a suite because there is nothing to run it
 * against yet. The suite gets written when a vendor is chosen — from this list,
 * not from the vendor's documentation.
 *
 *   1. A `staff` or `unknown` credential never yields an arrival.
 *   2. An event for a room with no stay in it resolves to nothing, and does not
 *      guess at the nearest reservation.
 *   3. A replayed webhook produces the same journey outcome as the first
 *      delivery — `arrival.confirm` is already idempotent, so this is really a
 *      check that the adapter does not fabricate a second event id.
 *   4. An unsigned or wrongly-signed payload throws rather than returning null.
 *      Null means "uninteresting"; an unverifiable payload is not uninteresting.
 */
export const DOOR_ADAPTER_REQUIREMENTS = [
  'staff and unknown credentials never confirm an arrival',
  'an event for a room with no stay resolves to nothing',
  'a replayed webhook is idempotent',
  'an unverifiable payload throws rather than returning null',
] as const
