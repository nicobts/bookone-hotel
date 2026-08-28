/**
 * The job queue port (ADR-005).
 *
 * pg-boss is the implementation and it lives in `apps/worker`. This interface
 * exists so that choice is reversible: ADR-005 accepts a throughput ceiling in
 * exchange for one fewer stateful service, and says to revisit through this
 * interface if volume grows tenfold. An interface written after that day would
 * be written around whatever pg-boss happens to do.
 *
 * Deliberately small. Everything here is something the sync engine actually
 * needs; nothing here is a pg-boss feature that looked useful.
 */

/**
 * The job names the platform knows.
 *
 * A closed union rather than free strings: a typo in `send()` would otherwise
 * enqueue a job no consumer is subscribed to, and that job would sit in the
 * queue succeeding at nothing. Adding a name here forces adding its payload
 * type below, which forces a handler.
 */
export const jobNames = [
  /** Pull availability for one property into `rate_snapshots` (2–5 min). */
  'availability.refresh',
  /** Write a platform-authored reservation through to the PMS. */
  'reservation.reflect',
  /** Nightly parity pass over one domain at one property. */
  'reconcile.nightly',
  /** Run one agent against one trigger (06 §3). */
  'agent.run',
] as const

export type JobName = (typeof jobNames)[number]

export interface JobPayloads {
  'availability.refresh': { propertyId: string; from: string; to: string }
  /**
   * Carries only the reservation id. The handler re-reads the row rather than
   * trusting a snapshot taken at enqueue time: the job may run minutes later,
   * after a cancellation, and reflecting a stale copy would push a booking the
   * hotel no longer has.
   */
  'reservation.reflect': { propertyId: string; reservationId: string }
  'reconcile.nightly': { propertyId: string; domain: string }
  /**
   * `input` is what the agent is being asked about. Carried on the job rather
   * than re-read by the handler: a fanned-out run must classify the values the
   * comparison actually saw, not whatever the row says by the time the job is
   * picked up.
   */
  'agent.run': {
    propertyId: string
    agent: string
    triggerEventId?: string
    input?: Record<string, unknown>
  }
}

export interface SendOptions {
  /**
   * Deduplication key. Two sends with the same key produce one job.
   *
   * This is what makes `reservation.reflect` safe to enqueue from anywhere: the
   * confirmation path, a retry sweep and an owner tapping "retry" in the
   * exceptions inbox can all fire, and the PMS still sees one booking. The
   * adapter is idempotent too — belt and braces, because this one is a
   * best-effort dedupe within a window and that one is a hard guarantee.
   */
  singletonKey?: string
  /** Seconds to wait before the job becomes visible. */
  startAfterSeconds?: number
  retryLimit?: number
  /** Seconds between retries; the implementation may apply backoff. */
  retryDelaySeconds?: number
}

export interface Job<N extends JobName = JobName> {
  id: string
  name: N
  data: JobPayloads[N]
}

export type JobHandler<N extends JobName> = (job: Job<N>) => Promise<void>

export interface JobQueue {
  send<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options?: SendOptions,
  ): Promise<string | null>

  /** Registers the consumer. One handler per name. */
  work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void>

  /** Cron. Used for `reconcile.nightly` and the scheduled agents. */
  schedule<N extends JobName>(name: N, cron: string, data: JobPayloads[N]): Promise<void>

  start(): Promise<void>
  stop(): Promise<void>
}
