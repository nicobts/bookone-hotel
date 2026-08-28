import type { JobQueue } from '@bookone/core/jobs'
import type { PmsAdapter } from '@bookone/core/adapters'
import { refreshAvailability, reconcileBookingDomain, reflectReservation } from '@bookone/core/sync'
import { expireHolds } from '@bookone/core/booking'
import {
  listPendingNotifications,
  sendNotification,
  type NotificationProvider,
} from '@bookone/core/notifications'
import { replayLostPayments, type PaymentAdapter } from '@bookone/core/payments'
import { listPrecheckinDue, sendPrecheckinInvite } from '@bookone/core/journey'
import {
  checkPendingAcknowledgements,
  deleteDocumentsForStay,
  listDocumentsToDelete,
  stageAlloggiati,
  submitAlloggiati,
  type AlloggiatiAdapter,
} from '@bookone/core/alloggiati'
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
  notifications: NotificationProvider
  payments: PaymentAdapter
  alloggiati: AlloggiatiAdapter
  /**
   * Destroys one stored object (E2.4).
   *
   * Injected rather than imported because core does not know what a bucket is
   * and the worker does — and because a job that deletes files should be
   * testable without a storage service.
   */
  deleteObject: (path: string) => Promise<boolean>
  logger: Logger
}

/**
 * How long a queued message may sit before the sweep picks it up.
 *
 * Longer than a send takes, so the sweep never races the direct enqueue and
 * mails a guest twice — and short enough to stay inside E1.2's sixty seconds
 * when the direct enqueue was the thing that failed.
 */
const SWEEP_AFTER_SECONDS = 30

/** Bounded, so one stuck property cannot starve the rest of a sweep. */
const SWEEP_BATCH = 50

/**
 * How long a payment may sit unsettled before we go and ask the provider.
 *
 * Long enough that an ordinary checkout — a guest reading the page, entering a
 * card, completing 3DS — is finished. Short enough that a lost webhook does not
 * leave money taken and no booking for the length of a hold.
 */
const PAYMENT_REPLAY_AFTER_SECONDS = 5 * 60

/**
 * How far ahead the pre-arrival sweep looks (E2.1: T-48h).
 *
 * Slightly more than 48 so an hourly sweep cannot miss the window by falling
 * between two runs — a guest invited at T-47 is fine; a guest never invited
 * because the sweep ticked at T-49 and again at T-47 is not.
 */
const PRECHECKIN_WINDOW_HOURS = 50

export async function registerHandlers(deps: HandlerDeps): Promise<void> {
  const { queue, adapter, notifications, payments, alloggiati, deleteObject, logger } = deps

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
        // Nights with nothing left. Not an error and not written — but worth
        // seeing, because "the booking page shows no rooms" and "the connector
        // is broken" look identical from the outside.
        soldOut: result.soldOut,
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

  await queue.work('notification.send', async (job) => {
    const { propertyId, notificationId } = job.data

    const outcome = await sendNotification({ provider: notifications }, { notificationId })

    logger.info(
      { jobId: job.id, propertyId, notificationId, outcome: outcome.status },
      'notification.send',
    )

    // Rethrown so the queue retries it. Everything else — an unknown template,
    // a channel this provider cannot send on — will fail identically next time,
    // and is already recorded on the row for the console to show.
    if (outcome.status === 'failed' && outcome.retryable) {
      throw new Error(outcome.error)
    }
  })

  await queue.work('notification.sweep', async (job) => {
    const pending = await listPendingNotifications({
      olderThanSeconds: SWEEP_AFTER_SECONDS,
      limit: SWEEP_BATCH,
    })

    for (const row of pending) {
      await queue.send(
        'notification.send',
        { propertyId: row.propertyId, notificationId: row.id },
        { singletonKey: `notify:${row.id}` },
      )
    }

    // Logged only when it found something. A sweep that runs every minute and
    // says "0" every minute is a log nobody reads, which is a log that hides
    // the minute it says 40.
    if (pending.length > 0) {
      logger.info({ jobId: job.id, swept: pending.length }, 'notification.sweep')
    }
  })

  await queue.work('payment.replay', async (job) => {
    const result = await replayLostPayments(
      { adapter: payments },
      { olderThanSeconds: PAYMENT_REPLAY_AFTER_SECONDS, limit: SWEEP_BATCH },
    )

    // Logged only when it found something to check. A recovery is worth an
    // alert, not a log line — money was taken and the webhook never arrived,
    // which is a provider problem somebody should know about.
    if (result.checked > 0) {
      logger.info(
        { jobId: job.id, checked: result.checked, recovered: result.recovered },
        'payment.replay',
      )
    }
  })

  await queue.work('precheckin.sweep', async (job) => {
    const due = await listPrecheckinDue({
      withinHours: PRECHECKIN_WINDOW_HOURS,
      limit: SWEEP_BATCH,
    })

    for (const stay of due) {
      // Fanned out one per stay rather than looped inline: one guest without an
      // email must not stop the rest being invited, and each invitation wants
      // its own retry.
      await queue.send(
        'precheckin.invite',
        { propertyId: stay.propertyId, reservationId: stay.reservationId },
        { singletonKey: `precheckin:${stay.reservationId}` },
      )
    }

    if (due.length > 0) {
      logger.info({ jobId: job.id, due: due.length }, 'precheckin.sweep')
    }
  })

  await queue.work('precheckin.invite', async (job) => {
    const { propertyId, reservationId } = job.data

    const outcome = await sendPrecheckinInvite({ propertyId, reservationId })

    logger.info({ jobId: job.id, reservationId, outcome: outcome.status }, 'precheckin.invite')

    if (outcome.status === 'invited' && outcome.notificationId) {
      await queue.send(
        'notification.send',
        { propertyId, notificationId: outcome.notificationId },
        { singletonKey: `notify:${outcome.notificationId}` },
      )
    }
  })

  await queue.work('alloggiati.file', async (job) => {
    const { propertyId, reservationId } = job.data

    const staged = await stageAlloggiati({ propertyId, reservationId, channel: alloggiati.channel })

    if (staged.status === 'incomplete') {
      // Not an error and not retryable: the party is missing a field only the
      // guest can supply. It surfaces in the exceptions inbox with the list.
      logger.warn(
        { jobId: job.id, reservationId, issues: staged.issues.length },
        'alloggiati.file — party incomplete',
      )
      return
    }

    if (staged.status === 'rejected') {
      logger.warn({ jobId: job.id, reservationId, reason: staged.reason }, 'alloggiati.file')
      return
    }

    const filed = await submitAlloggiati({ adapter: alloggiati }, { propertyId, reservationId })

    logger.info(
      { jobId: job.id, reservationId, outcome: filed.status, channel: alloggiati.channel },
      'alloggiati.file',
    )

    // Rethrown so the queue retries. A rejected payload is not retryable and is
    // already recorded on the row for the console to show.
    if (filed.status === 'failed' && filed.retryable) throw new Error(filed.reason)

    if (filed.status === 'acknowledged') {
      await queue.send('documents.purge', {}, { singletonKey: 'documents-purge' })
    }
  })

  await queue.work('alloggiati.check', async (job) => {
    const result = await checkPendingAcknowledgements(
      { adapter: alloggiati },
      { limit: SWEEP_BATCH },
    )

    if (result.checked > 0) {
      logger.info(
        { jobId: job.id, checked: result.checked, acknowledged: result.acknowledged },
        'alloggiati.check',
      )
    }

    if (result.acknowledged > 0) {
      await queue.send('documents.purge', {}, { singletonKey: 'documents-purge' })
    }
  })

  await queue.work('documents.purge', async (job) => {
    const due = await listDocumentsToDelete({ limit: SWEEP_BATCH })

    let deleted = 0
    let failed = 0

    for (const stay of due) {
      const outcome = await deleteDocumentsForStay(
        { deleteObject },
        { propertyId: stay.propertyId, reservationId: stay.reservationId },
      )

      deleted += outcome.deleted
      failed += outcome.failed
    }

    // Always logged when it did anything. This job destroys personal data on
    // purpose (E2.4), and a silent one is a job nobody can show worked.
    if (deleted > 0 || failed > 0) {
      logger.info({ jobId: job.id, stays: due.length, deleted, failed }, 'documents.purge')
    }
  })

  await queue.work('reservation.expire_holds', async (job) => {
    const { expired } = await expireHolds()

    if (expired > 0) {
      logger.info({ jobId: job.id, expired }, 'reservation.expire_holds')
    }
  })
}
