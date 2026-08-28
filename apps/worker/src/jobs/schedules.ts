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

export async function registerSchedules(deps: { queue: JobQueue; logger: Logger }): Promise<void> {
  const { queue, logger } = deps

  // Read at boot. A property added afterwards is not scheduled until the next
  // restart — acceptable while onboarding is a founder-run process (Sprint 9
  // makes it self-service), and stated here rather than discovered when a new
  // hotel's first reconciliation never runs.
  const rows = await asService((db) =>
    db.select({ id: properties.id, slug: properties.slug }).from(properties),
  )

  for (const property of rows) {
    await queue.schedule('reconcile.nightly', NIGHTLY_RECONCILE, {
      propertyId: property.id,
      domain: 'booking',
    })
  }

  logger.info(
    { properties: rows.length, cron: NIGHTLY_RECONCILE },
    'nightly reconciliation scheduled',
  )
}
