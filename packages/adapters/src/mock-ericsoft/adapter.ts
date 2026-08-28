import {
  PmsAdapterError,
  type AdapterHealth,
  type AvailabilityEntry,
  type AvailabilityQuery,
  type AvailabilityResult,
  type ExternalReference,
  type PmsAdapter,
  type PmsErrorCode,
  type PmsReservation,
  type ReflectInput,
} from '@bookone/core/adapters'

/**
 * MockEricsoftAdapter — deterministic fixtures with failure injection
 * (03-ARCHITECTURE §4, ADR-008).
 *
 * Ships before the real connector because WS-C is a 2–5 month external queue
 * and the exception paths are the hardest code in the sync engine. They need
 * failure conditions to exist before the real API does, or they get written
 * against an imagination of how the PMS breaks.
 *
 * The injection surface is the point, not the happy path. Reflection failures,
 * timeouts, throttling and stale availability have to be reproducible so the
 * exceptions inbox and its resolution actions can be built and tested in
 * Sprint 2 — years before Ericsoft teaches us its own quirks.
 *
 * **Deterministic by construction.** No clock reads and no randomness: prices
 * derive from a hash of the inputs, and failures fire on an explicit schedule
 * rather than a probability. A flaky mock produces a flaky suite, and a flaky
 * suite gets skipped.
 */

export interface MockFailure {
  /** Which call fails. `any` covers all four. */
  on: 'getAvailability' | 'getReservation' | 'reflectReservation' | 'postCheckIn' | 'any'
  code: PmsErrorCode
  /**
   * Fail this many times, then start succeeding. `Infinity` never recovers.
   * Counting rather than a probability is what makes retry behaviour testable:
   * "fails twice then succeeds" is a scenario, "fails 30% of the time" is a
   * coin toss that will eventually pass a broken retry loop.
   */
  times: number
}

export interface MockOptions {
  /** Simulated latency in ms. The clock is the caller's; see `sleep`. */
  latencyMs?: number
  failures?: MockFailure[]
  /**
   * How stale `getAvailability` claims its data is, in seconds. The booking
   * surface must never show availability older than five minutes (PRD A2), and
   * this is how that rule gets a failing case.
   */
  availabilityAgeSeconds?: number
  /** Fixed clock, so every assertion about time is reproducible. */
  now?: () => Date
  roomTypeCodes?: string[]
}

const RETRYABLE: Record<PmsErrorCode, boolean> = {
  unavailable: true,
  throttled: true,
  unauthorized: false,
  rejected: false,
  not_found: false,
}

export class MockEricsoftAdapter implements PmsAdapter {
  readonly system = 'ericsoft'

  private readonly latencyMs: number
  private readonly availabilityAgeSeconds: number
  private readonly roomTypeCodes: string[]
  private readonly now: () => Date
  private readonly failures: MockFailure[]

  /**
   * Reflected reservations, keyed by our UUID.
   *
   * This map is what makes `reflectReservation` idempotent, which is not a mock
   * convenience — it is the contract the real adapter has to honour. The
   * reflection job retries, and a second call for one reservation must not
   * create a second booking in a hotel's PMS.
   */
  private readonly reflected = new Map<string, ExternalReference>()

  /** Seeded so a test can arrange a reservation the connector already knows. */
  private readonly reservations = new Map<string, PmsReservation>()

  /** Booking numbers, assigned by "the PMS". Per-instance, so runs stay stable. */
  private sequence = 0

  constructor(options: MockOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0
    this.availabilityAgeSeconds = options.availabilityAgeSeconds ?? 0
    this.roomTypeCodes = options.roomTypeCodes ?? ['DBL', 'SGL']
    this.now = options.now ?? (() => new Date('2026-09-01T08:00:00Z'))
    this.failures = (options.failures ?? []).map((failure) => ({ ...failure }))
  }

  async getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    await this.gate('getAvailability')

    const codes = query.roomTypeCode ? [query.roomTypeCode] : this.roomTypeCodes
    const entries: AvailabilityEntry[] = []

    for (const date of datesBetween(query.from, query.to)) {
      for (const code of codes) {
        const seed = hash(`${query.propertyId}:${code}:${date}`)
        entries.push({
          roomTypeCode: code,
          date,
          // Deterministic but varied: 0–7 rooms, so "sold out" is reachable.
          available: seed % 8,
          priceCents: 8000 + (seed % 12) * 500,
          currency: 'EUR',
        })
      }
    }

    return {
      entries,
      fetchedAt: new Date(this.now().getTime() - this.availabilityAgeSeconds * 1000),
    }
  }

  async getReservation(propertyId: string, externalId: string): Promise<PmsReservation | null> {
    await this.gate('getReservation')

    return this.reservations.get(`${propertyId}:${externalId}`) ?? null
  }

  async reflectReservation(input: ReflectInput): Promise<ExternalReference> {
    await this.gate('reflectReservation')

    // Idempotency first, before any side effect: a retry after a timeout must
    // return the original reference rather than book the room twice.
    const existing = this.reflected.get(input.reservationId)
    if (existing) return existing

    // Sequential, like a real PMS assigning its own booking number — NOT
    // derived from our UUID.
    //
    // Deriving it would make this method idempotent by accident, whatever the
    // guard above did, and the contract's idempotency test would pass against
    // an adapter that double-books. Verified: with the guard removed and ids
    // derived, the suite stayed green. The mock has to be able to get this
    // wrong, or the contract cannot prove the real adapter gets it right.
    this.sequence += 1
    const reference: ExternalReference = {
      system: this.system,
      externalId: `ERI-${String(this.sequence).padStart(6, '0')}`,
    }

    this.reflected.set(input.reservationId, reference)
    this.reservations.set(`${input.propertyId}:${reference.externalId}`, {
      externalId: reference.externalId,
      roomTypeCode: input.roomTypeCode,
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      guestName: input.guestName,
      ...(input.guestEmail !== undefined ? { guestEmail: input.guestEmail } : {}),
      status: 'confirmed',
      ...(input.totalCents !== undefined ? { totalCents: input.totalCents } : {}),
      currency: input.currency ?? 'EUR',
    })

    return reference
  }

  async postCheckIn(propertyId: string, externalId: string, _at: Date): Promise<void> {
    await this.gate('postCheckIn')

    const key = `${propertyId}:${externalId}`
    const reservation = this.reservations.get(key)

    if (!reservation) {
      throw new PmsAdapterError(
        'not_found',
        `No reservation ${externalId} at property ${propertyId}`,
        false,
      )
    }

    this.reservations.set(key, { ...reservation, status: 'checked_in' })
  }

  async healthCheck(): Promise<AdapterHealth> {
    const pending = this.failures.find((failure) => failure.times > 0)

    // Honest status: the console shows owners connector health as it is, not as
    // we would like it (03 §8). A mock that always reports healthy would make
    // that surface untestable.
    return {
      healthy: !pending,
      ...(pending ? { message: `Injected failure pending: ${pending.code}` } : {}),
      latencyMs: this.latencyMs,
      checkedAt: this.now(),
    }
  }

  // ---------------------------------------------------------------- test seams

  /** Arranges a reservation the connector already knows about. */
  seedReservation(propertyId: string, reservation: PmsReservation): void {
    this.reservations.set(`${propertyId}:${reservation.externalId}`, reservation)
  }

  /** Adds a failure after construction, for a scenario mid-test. */
  injectFailure(failure: MockFailure): void {
    this.failures.push({ ...failure })
  }

  /** How many failures are still queued. Lets a test assert it exhausted them. */
  pendingFailures(): number {
    return this.failures.reduce((total, failure) => total + Math.max(0, failure.times), 0)
  }

  // ------------------------------------------------------------------ internals

  private async gate(method: MockFailure['on']): Promise<void> {
    if (this.latencyMs > 0) await sleep(this.latencyMs)

    const failure = this.failures.find(
      (candidate) => (candidate.on === method || candidate.on === 'any') && candidate.times > 0,
    )

    if (!failure) return

    failure.times -= 1

    throw new PmsAdapterError(
      failure.code,
      `Injected ${failure.code} on ${method}`,
      RETRYABLE[failure.code],
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** FNV-1a. Small, stable, and dependency-free — this is a fixture, not a hash. */
function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return Math.abs(result)
}

/** Inclusive of `from`, exclusive of `to` — a stay's nights, not its days. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)

  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}
