import type { JobQueue } from '@bookone/core/jobs'
import type { PmsAdapter } from '@bookone/core/adapters'
import { refreshAvailability, reconcileBookingDomain, reflectReservation } from '@bookone/core/sync'
import { runAgent } from '@bookone/agents/runner'
import type { Logger } from 'pino'

/**
 * Job handlers.
 *
 * Deliberately thin. Every one reads a payload, calls a domain function in
 * `@bookone/core`, and logs the outcome — the decisions live in core so the
 * same logic is reachable from a test, a console action and a future HTTP
 * endpoint without being reimplemented.
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

    const result = await refreshAvailability({ adapter }, { propertyId, from, to })

    logger.info(
      {
        jobId: job.id,
        propertyId,
        written: result.written,
        // Skipped means the connector named a room type this property does not
        // have. Worth seeing: it is usually a room added in the PMS and not
        // here, which the onboarding wizard will eventually reconcile.
        skipped: result.skipped,
      },
      'availability.refresh',
    )
  })

  await queue.work('reconcile.nightly', async (job) => {
    const { propertyId, domain } = job.data

    if (domain !== 'booking') {
      // Only the booking domain is comparable in V1. Others are PMS-authoritative,
      // and reconciling a source against itself measures nothing.
      logger.info({ jobId: job.id, propertyId, domain }, 'reconcile.nightly skipped')
      return
    }

    const result = await reconcileBookingDomain({ adapter }, { propertyId })

    if (!result) {
      logger.info({ jobId: job.id, propertyId }, 'reconcile.nightly not applicable')
      return
    }

    logger.info(
      {
        jobId: job.id,
        propertyId,
        compared: result.comparedCount,
        discrepancies: result.discrepanciesCount,
        parityRatio: result.parityRatio,
      },
      'reconcile.nightly',
    )

    // One agent run per discrepancy, each carrying the values the comparison
    // saw. Fanned out as separate jobs rather than looped inline: one agent
    // failing must not fail the run that found the rest, and every run wants
    // its own `agent_runs` row anyway.
    //
    // The singleton key is the run and the entity together, so a retried
    // reconciliation does not classify the same finding twice.
    for (const finding of result.found) {
      await queue.send(
        'agent.run',
        {
          propertyId,
          agent: 'AG-05',
          input: { ours: finding.ours, theirs: finding.theirs },
        },
        { singletonKey: `ag-05:${result.runId}:${finding.entityRef}` },
      )
    }
  })

  await queue.work('agent.run', async (job) => {
    const { propertyId, agent, triggerEventId } = job.data

    const outcome = await runAgent({
      agent,
      propertyId,
      ...(triggerEventId ? { triggerEventId: BigInt(triggerEventId) } : {}),
      input: job.data.input ?? {},
    })

    logger.info(
      {
        jobId: job.id,
        propertyId,
        agent,
        runId: outcome.runId,
        status: outcome.status,
        tier: outcome.tierApplied,
      },
      'agent.run',
    )
  })
}
