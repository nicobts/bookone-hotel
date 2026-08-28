import type { JobQueue } from '@bookone/core/jobs'
import type { PmsAdapter } from '@bookone/core/adapters'
import { reflectReservation } from '@bookone/core/sync'
import type { Logger } from 'pino'

/**
 * Job handlers.
 *
 * Deliberately thin. Every one of these reads a payload, calls a domain
 * function in `@bookone/core`, and logs the outcome — the decisions live in
 * core so the same logic is reachable from a test, a console action and a
 * future HTTP endpoint without being reimplemented (binding rule: all domain
 * logic in packages/core).
 */

export interface HandlerDeps {
  queue: JobQueue
  adapter: PmsAdapter
  logger: Logger
}

export async function registerHandlers(deps: HandlerDeps): Promise<void> {
  const { queue, adapter, logger } = deps

  await queue.work('reservation.reflect', async (job) => {
    const { propertyId, reservationId } = job.data

    const outcome = await reflectReservation({ adapter }, { propertyId, reservationId })

    logger.info(
      { jobId: job.id, propertyId, reservationId, outcome: outcome.status },
      'reservation.reflect',
    )
  })

  await queue.work('availability.refresh', async (job) => {
    const { propertyId, from, to } = job.data

    // Reads only. `rate_snapshots` is a display cache and never an authority
    // (03 §2), so nothing here can change what a guest is owed — the worst a
    // bad refresh does is show a stale price, which A2's provenance rule makes
    // traceable to this fetch.
    const result = await adapter.getAvailability({ propertyId, from, to })

    logger.info(
      { jobId: job.id, propertyId, entries: result.entries.length, fetchedAt: result.fetchedAt },
      'availability.refresh',
    )
  })

  await queue.work('reconcile.nightly', async (job) => {
    const { propertyId, domain } = job.data

    logger.info({ jobId: job.id, propertyId, domain }, 'reconcile.nightly')
  })

  await queue.work('agent.run', async (job) => {
    const { propertyId, agent } = job.data

    logger.info({ jobId: job.id, propertyId, agent }, 'agent.run')
  })
}
