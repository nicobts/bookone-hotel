import { asService, properties } from '@bookone/core/db'
import type { JobQueue } from '@bookone/core/jobs'
import type { Logger } from 'pino'

/**
 * Recurring work.
 *
 * Reconciliation is nightly, per property, in the property's own local time —
 * "nightly" for a hotel means after its last checkout, not at 02:00 UTC. The
 * queue applies `Europe/Rome`, which is correct for IT/AT/SI today and becomes
 * per-property when a house outside that zone onboards.
 *
 * 03:30 rather than midnight: late arrivals are still being keyed in at
 * midnight, and comparing two systems while one of them is being typed into
 * produces discrepancies that resolve themselves by morning — which is the
 * fastest way to teach an owner to ignore the inbox.
 */
const NIGHTLY_RECONCILE = '30 3 * * *'

/**
 * Availability refresh, per property.
 *
 * Two minutes is what keeps the booking surface inside its staleness threshold
 * (`AVAILABILITY_MAX_AGE_MS`, fifteen minutes) with room for several failed
 * polls in between. The relationship between these two numbers is the whole
 * design: a cadence slower than the threshold means the surface falls back to
 * the request form during normal operation, which costs the hotel real direct
 * bookings. Change one and check the other.
 */
const AVAILABILITY_REFRESH = '*/2 * * * *'

/**
 * How far ahead the cache is kept warm.
 *
 * A booking window, not a data-completeness goal. Ninety days covers the
 * overwhelming majority of direct bookings at a small independent hotel; a
 * guest searching beyond it gets the request form, which is the honest answer
 * for dates the hotel has probably not priced yet either.
 */
const AVAILABILITY_HORIZON_DAYS = 90

/** Holds are thirty minutes (E1.3); five is fine granularity for expiring them. */
const EXPIRE_HOLDS = '*/5 * * * *'

/** The outbox safety net. See the sweep handler for why it is not the primary path. */
const NOTIFICATION_SWEEP = '* * * * *'

/**
 * The webhook safety net (04 §1 Sprint 4: webhook-loss replay).
 *
 * Every two minutes, because the failure it catches is the worst one available:
 * a guest charged for a booking that was never confirmed. Cheap when there is
 * nothing to do — it queries for unsettled intents older than five minutes and
 * usually finds none.
 */
const PAYMENT_REPLAY = '*/2 * * * *'

export async function registerSchedules(deps: { queue: JobQueue; logger: Logger }): Promise<void> {
  const { queue, logger } = deps

  // Read at boot. A property added afterwards is not scheduled until the next
  // restart — acceptable while onboarding is a founder-run process (Sprint 9
  // makes it self-service), and stated here rather than discovered when a new
  // hotel's first reconciliation never runs.
  const rows = await asService((db) =>
    db.select({ id: properties.id, slug: properties.slug }).from(properties),
  )

  const today = new Date()
  const horizon = new Date(today.getTime() + AVAILABILITY_HORIZON_DAYS * 86_400_000)

  for (const property of rows) {
    await queue.schedule(
      'reconcile.nightly',
      NIGHTLY_RECONCILE,
      { propertyId: property.id, domain: 'booking' },
      { key: property.id },
    )

    // The window is fixed at boot rather than rolling. A cron payload is static
    // — pg-boss stores it once — so a long-running process would otherwise keep
    // refreshing a window that recedes into the past. The restart that fixes it
    // is the same restart that picks up new properties, which is the honest
    // shape of this until Sprint 9 replaces both.
    await queue.schedule(
      'availability.refresh',
      AVAILABILITY_REFRESH,
      { propertyId: property.id, from: isoDate(today), to: isoDate(horizon) },
      { key: property.id },
    )
  }

  // Remove schedules that no longer correspond to a property.
  //
  // Schedules outlive the process that created them, so without this the set
  // only ever grows: a property removed keeps being reconciled, and — the case
  // that actually happened here — a keyless schedule written by an older build
  // keeps firing alongside the keyed ones, refreshing one property twice and
  // making the log look like the fix did not work.
  const live = new Set(rows.map((property) => property.id))

  for (const name of ['availability.refresh', 'reconcile.nightly'] as const) {
    for (const schedule of await queue.listSchedules(name)) {
      if (live.has(schedule.key)) continue

      await queue.unschedule(name, schedule.key)
      logger.info({ job: name, key: schedule.key }, 'removed a stale schedule')
    }
  }

  // Cross-property maintenance. Scheduled once, and therefore needing no key:
  // a hold that expired at a property this loop never reached is exactly the
  // hold that needs expiring.
  await queue.schedule('reservation.expire_holds', EXPIRE_HOLDS, {})
  await queue.schedule('notification.sweep', NOTIFICATION_SWEEP, {})
  await queue.schedule('payment.replay', PAYMENT_REPLAY, {})

  logger.info(
    {
      properties: rows.length,
      reconcile: NIGHTLY_RECONCILE,
      availability: AVAILABILITY_REFRESH,
      availabilityThrough: isoDate(horizon),
      expireHolds: EXPIRE_HOLDS,
      notificationSweep: NOTIFICATION_SWEEP,
      paymentReplay: PAYMENT_REPLAY,
    },
    'schedules registered',
  )
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
