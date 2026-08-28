import type {
  agentRuns,
  domainEvents,
  externalRefs,
  guests,
  profiles,
  properties,
  propertyMembers,
  rateSnapshots,
  reservations,
  roomTypes,
} from '../db/schema'

/**
 * Canonical domain types, derived from the Drizzle schema.
 *
 * Derived, never hand-written (binding rule 10). A duplicate interface here
 * would drift from the column it describes the first time anyone adds a field,
 * and the compiler would keep agreeing with both.
 *
 * Type flow is one-way and ends here for the server: Drizzle schema -> these
 * types -> Hono RPC -> web.
 */

export type Property = typeof properties.$inferSelect
export type NewProperty = typeof properties.$inferInsert

export type Profile = typeof profiles.$inferSelect
export type PropertyMember = typeof propertyMembers.$inferSelect

export type ExternalRef = typeof externalRefs.$inferSelect
export type NewExternalRef = typeof externalRefs.$inferInsert

export type Guest = typeof guests.$inferSelect
export type NewGuest = typeof guests.$inferInsert

export type RoomType = typeof roomTypes.$inferSelect
export type NewRoomType = typeof roomTypes.$inferInsert

export type RateSnapshot = typeof rateSnapshots.$inferSelect
export type NewRateSnapshot = typeof rateSnapshots.$inferInsert

export type Reservation = typeof reservations.$inferSelect
export type NewReservation = typeof reservations.$inferInsert

export type DomainEvent = typeof domainEvents.$inferSelect
export type NewDomainEvent = typeof domainEvents.$inferInsert

export type AgentRun = typeof agentRuns.$inferSelect
export type NewAgentRun = typeof agentRuns.$inferInsert

/** Roles a person can hold at a property (PRD D3). */
export type MemberRole = PropertyMember['role']

/** Where a reservation was born (ADR-001). */
export type ReservationOrigin = Reservation['origin']

export type ReservationStatus = Reservation['status']

/** Which half of the dual-source engine wrote a row (binding rule 2). */
export type EventOrigin = DomainEvent['origin']
