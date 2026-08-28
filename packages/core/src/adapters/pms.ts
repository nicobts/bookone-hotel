/**
 * The PMS port (03-ARCHITECTURE §4, ADR-008).
 *
 * The domain depends on this interface; only `@bookone/adapters` knows a vendor
 * exists. Shared with the Concierge and Rooms workstreams, so it is deliberately
 * narrow — every method here is one the sync engine actually calls.
 */

export interface AvailabilityQuery {
  propertyId: string
  /** Hotel-local calendar dates, not instants. */
  from: string
  to: string
  roomTypeCode?: string
}

export interface AvailabilityEntry {
  roomTypeCode: string
  date: string
  available: number
  priceCents: number
  currency: string
}

export interface AvailabilityResult {
  entries: AvailabilityEntry[]
  /**
   * When the source produced this. The booking surface must never show
   * availability staler than five minutes (PRD A2), and it cannot know that
   * without being told when the data was true.
   */
  fetchedAt: Date
}

/**
 * A reservation as the PMS understands it.
 *
 * Deliberately not our `Reservation` type: theirs has their ids and their
 * vocabulary, and collapsing the two is how a canonical model stops being
 * canonical (ADR-001).
 */
export interface PmsReservation {
  externalId: string
  roomTypeCode: string
  arrivalDate: string
  departureDate: string
  guestName: string
  guestEmail?: string
  status: string
  totalCents?: number
  currency?: string
}

export interface ReflectInput {
  /** Our UUID. Also the idempotency key — a retried reflect must not duplicate. */
  reservationId: string
  propertyId: string
  roomTypeCode: string
  arrivalDate: string
  departureDate: string
  guestName: string
  guestEmail?: string
  totalCents?: number
  currency?: string
}

export interface ExternalReference {
  system: string
  externalId: string
}

export interface AdapterHealth {
  healthy: boolean
  /** Surfaced in the console: owners see connector status honestly (03 §8). */
  message?: string
  latencyMs?: number
  checkedAt: Date
}

export interface PmsAdapter {
  readonly system: string

  getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult>

  getReservation(propertyId: string, externalId: string): Promise<PmsReservation | null>

  /**
   * Write-through. Idempotent on `reservationId`: the reflection job retries,
   * and a second call for the same reservation must return the same reference
   * rather than create a second booking in the hotel's PMS.
   */
  reflectReservation(input: ReflectInput): Promise<ExternalReference>

  postCheckIn(propertyId: string, externalId: string, at: Date): Promise<void>

  healthCheck(): Promise<AdapterHealth>
}

/**
 * What the adapter throws.
 *
 * `retryable` is the field the job queue reads. Getting it wrong in either
 * direction is expensive: a retryable error marked permanent drops a
 * reservation on the floor, and a permanent error marked retryable burns the
 * queue against an endpoint that will never accept it.
 */
export class PmsAdapterError extends Error {
  readonly retryable: boolean
  readonly code: PmsErrorCode

  constructor(code: PmsErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'PmsAdapterError'
    this.code = code
    this.retryable = retryable
  }
}

export type PmsErrorCode =
  /** Network, 5xx, timeout — the PMS may work in a minute. */
  | 'unavailable'
  /** Rate limited. Retryable, but back off. */
  | 'throttled'
  /** Credentials rejected. Retrying cannot fix it; the owner must act. */
  | 'unauthorized'
  /** The PMS rejected the payload. A bug on our side, or a real conflict. */
  | 'rejected'
  /** Asked for something that is not there. */
  | 'not_found'
