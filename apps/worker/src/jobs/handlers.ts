import type { JobHandler, JobName, JobQueue } from '@bookone/core/jobs'
import {
  createFeatureCheck,
  gateOpen,
  JOB_FEATURE,
  type FeatureCheck,
} from '@bookone/core/onboarding'
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
  type AlloggiatiAdapter,
} from '@bookone/core/alloggiati'
import {
  alertEscalation,
  auditToolBoundary,
  listBreachedComplaints,
  listOverdueEscalations,
  markComplaintBreachAlerted,
  markSlaAlerted,
  propertiesWithAgentReplies,
} from '@bookone/core/concierge'
import {
  closeDepartedStay,
  completeArrival,
  listDepartedStays,
  listUnroutedInvoiceRequests,
  markInvoiceRouted,
  queueInvoiceRequestToProperty,
} from '@bookone/core/stay'
import {
  buildReport,
  listPropertiesForReports,
  previousPeriod,
  propertiesWithAttributedFees,
} from '@bookone/core/billing'
import { eraseGuest, resolveRequest, runRetention } from '@bookone/core/privacy'
import { guestActor, systemActor, userActor } from '@bookone/core/events'
import { runAgent } from '@bookone/agents/runner'
import { listProviders } from '@bookone/core/llm'
import { readDocument } from '@bookone/core/alloggiati'
import { getDocumentPath, recordDocumentReading } from '@bookone/core/journey'
import { respondToGuestMessage } from '@bookone/agents/concierge'
import { respondToOwner } from '@bookone/agents/owner'
import {
  channelTarget,
  getPropertyBasics,
  pendingReplies,
  recordDelivery,
  recordDeliveryFailure,
  threadsWithPendingReplies,
} from '@bookone/core/channels'
import { isEntitled } from '@bookone/core/onboarding'
import { recordPreview } from '@bookone/core/preview'
import {
  getReservationFacts,
  ownerNotUnderstoodPhrase,
  unmatchedSenderPhrase,
} from '@bookone/core/concierge'
import type { Logger } from 'pino'
import { traceJob } from '@bookone/core/telemetry'
import {
  ALLOGGIATI_ADAPTER_ID,
  WEBTUR_FVG_ADAPTER_ID,
  createWebturComplianceAdapter,
  generateIstatMovements,
  type IstatTransport,
  alertDueObligations,
  createAlloggiatiComplianceAdapter,
  generateGuestRegistrations,
  listDueObligations,
  listObligationIds,
  purgeReceiptFiles,
  reconcileAlloggiatiDay,
  retryManualObligation,
  runObligation,
} from '@bookone/core/compliance'
import { syncPropertySchedules } from './schedules'

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
   * WebTur's route for the ISTAT return (WP1.3). Null in production, where
   * only a simulated one exists: the obligation then has no adapter and the
   * manual route applies, rather than a simulated filing that looks real.
   */
  istat?: IstatTransport | null
  /**
   * Destroys one stored object (E2.4).
   *
   * Injected rather than imported because core does not know what a bucket is
   * and the worker does — and because a job that deletes files should be
   * testable without a storage service.
   */
  deleteObject: (path: string) => Promise<boolean>
  /**
   * Destroys one manual-filing receipt file (WP1.6), in its own bucket.
   * Optional: without it the purge deletes nothing and stamps nothing.
   */
  deleteReceipt?: (path: string) => Promise<boolean>
  /**
   * Reads one stored document as base64 (WP0.4). Injected for the same reason
   * as `deleteObject`. Optional: without it the extraction job reads nothing.
   */
  readObject?: (path: string) => Promise<{ mediaType: string; data: string } | null>
  /**
   * The public base URL, for links a guest or an owner will click.
   *
   * Injected rather than read from the environment here, like every other
   * dependency in this file: a handler that reaches for `process.env` is a
   * handler that cannot be tested without one.
   */
  appUrl: string
  logger: Logger
  /**
   * A fresh feature check per job run (ADR-019). Defaults to reading
   * entitlements; injected so the gating test needs no database.
   */
  featureCheck?: () => FeatureCheck
  /**
   * WhatsApp and SMS (ADR-035), when configured. Provider-neutral on purpose:
   * the handlers send through the port and ask for a purge, and never learn
   * which provider that is. Absent, the channel jobs log and do nothing.
   */
  messaging?: {
    provider: NotificationProvider
    /** Delete a finished message from the provider's log. */
    purge: (providerMessageId: string) => Promise<void>
    /** Whether a send error is worth retrying (rate limit, provider down). */
    retryable: (error: unknown) => boolean
  } | null
  /** Approved WhatsApp template ids by notification template (ADR-035). */
  whatsappTemplates?: Readonly<Record<string, string>>
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

/**
 * How long a guest may wait on a person before the property is told (E3.2).
 *
 * Thirty minutes, and the number is a judgement about the buyer rather than an
 * industry benchmark: our escalation target is a phone in an apron pocket, and
 * the person holding it is legitimately unavailable for stretches. Alerting
 * after five would be alerting during breakfast service, every day, until they
 * muted us. Per-property configuration is a Sprint 9 setting; a constant now is
 * better than a field nobody fills in.
 */
const ESCALATION_SLA_MINUTES = 30

/**
 * How far back the nightly tool-boundary audit looks (E3.2).
 *
 * A day and a bit, so a run that is skipped or fails cannot leave a window
 * nothing ever checked. Re-auditing yesterday costs a query and re-logs a
 * violation that is still true, which is the right direction to be wrong in.
 */
const AUDIT_WINDOW_HOURS = 30

/**
 * How far back the attribution auditor re-checks (AG-07, E5.4).
 *
 * Forty days, so a statement issued in the first week of a month has had every
 * fee in it checked at least once while the month was still open — and a run
 * that fails for a night cannot leave a window nothing ever looked at.
 *
 * Re-auditing a fee already credited costs one query and changes nothing: the
 * unique constraint on `fee_disputes.fee_event_id` means the concession is made
 * once whatever the window is.
 */
const ATTRIBUTION_AUDIT_WINDOW_DAYS = 40

export async function registerHandlers(deps: HandlerDeps): Promise<void> {
  const { queue, adapter, notifications, payments, alloggiati, deleteObject, appUrl, logger } = deps
  const featureCheck = deps.featureCheck ?? (() => createFeatureCheck())
  const messaging = deps.messaging ?? null

  /**
   * `queue.work`, gated (ADR-019).
   *
   * A job whose payload names a property does nothing for a property without
   * the job's feature — whoever enqueued it, and whenever. Checked when the job
   * runs, not when it was sent, so a revoke stops work already queued.
   *
   * Cross-property sweeps carry no property; they filter inside, in the query
   * that feeds them.
   */
  async function work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void> {
    const gate = JOB_FEATURE[name]

    await queue.work(name, async (job) => {
      const propertyId = (job.data as { propertyId?: unknown }).propertyId

      // One span per job run, with duration and outcome as metrics (ADR-036).
      await traceJob(
        {
          name,
          id: job.id,
          propertyId: typeof propertyId === 'string' ? propertyId : null,
          ...(job.trace ? { trace: job.trace } : {}),
        },
        () => run(job, propertyId),
      )
    })

    async function run(job: Parameters<JobHandler<N>>[0], propertyId: unknown): Promise<void> {
      if (
        gate !== 'core' &&
        typeof propertyId === 'string' &&
        !(await gateOpen(featureCheck(), propertyId, gate))
      ) {
        logger.info({ jobId: job.id, job: name, propertyId, feature: gate }, 'skipped: feature off')
        return
      }

      await handler(job)
    }
  }

  await work('reservation.reflect', async (job) => {
    const { propertyId, reservationId } = job.data

    const outcome = await reflectReservation({ adapter }, { propertyId, reservationId })

    logger.info(
      { jobId: job.id, propertyId, reservationId, outcome: outcome.status },
      'reservation.reflect',
    )
  })

  await work('availability.refresh', async (job) => {
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

  await work('reconcile.nightly', async (job) => {
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

  await work('agent.run', async (job) => {
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

  await work('notification.send', async (job) => {
    const { propertyId, notificationId } = job.data

    const outcome = await sendNotification(
      {
        provider: notifications,
        ...(messaging ? { providers: [messaging.provider] } : {}),
        ...(deps.whatsappTemplates ? { templateIds: deps.whatsappTemplates } : {}),
      },
      { notificationId },
    )

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

  await work('notification.sweep', async (job) => {
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

  await work('payment.replay', async (job) => {
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

  await work('precheckin.sweep', async (job) => {
    const due = await listPrecheckinDue({
      withinHours: PRECHECKIN_WINDOW_HOURS,
      limit: SWEEP_BATCH,
      feature: 'prearrival',
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

  await work('precheckin.invite', async (job) => {
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

  /*
   * Compliance obligations (ADR-039). The adapters this process can run, by
   * registry id; an id the registry names without one here is reported by
   * generation, never guessed at. Alloggiati is the Sprint 6 port behind its
   * bridge — the mock outside production, and the boot guard refuses a
   * simulated one in production.
   */
  const compliance = {
    adapters: new Map([
      [ALLOGGIATI_ADAPTER_ID, createAlloggiatiComplianceAdapter(alloggiati)],
      ...(deps.istat
        ? ([[WEBTUR_FVG_ADAPTER_ID, createWebturComplianceAdapter(deps.istat)]] as const)
        : []),
    ]),
  }

  /** One step for one obligation, logged as the wait point it is (ADR-025). */
  async function stepObligation(jobId: string, obligationId: string): Promise<void> {
    const result = await runObligation(compliance, obligationId)
    logger.info({ jobId, obligationId, ...result }, 'compliance.run')

    if (result.status === 'advanced' && result.to === 'acknowledged') {
      // The filing is accepted: identity documents may go now (E2.4).
      await queue.send('documents.purge', {}, { singletonKey: 'documents-purge' })
    }
  }

  /*
   * The arrival path and the console's "file now". Creates the stay's
   * obligation if the sweep has not yet, then advances it at once rather than
   * waiting for the next sweep. Everything else — confirmation, retries, the
   * hand-over before the deadline — is the lifecycle's.
   */
  await work('alloggiati.file', async (job) => {
    const { propertyId, reservationId } = job.data

    const generated = await generateGuestRegistrations(compliance, {
      limit: 1,
      propertyId,
      reservationId,
    })
    const obligations = await listObligationIds({ propertyId, reservationId })

    logger.info(
      { jobId: job.id, reservationId, created: generated.created, obligations: obligations.length },
      'alloggiati.file',
    )

    for (const obligationId of obligations) await stepObligation(job.id, obligationId)
  })

  await work('compliance.generate', async (job) => {
    const registrations = await generateGuestRegistrations(compliance, { limit: SWEEP_BATCH })
    // One ISTAT return per day, zero days included (WP1.3).
    const movements = await generateIstatMovements(compliance)
    const result = {
      created: registrations.created + movements.created,
      rescheduled: registrations.rescheduled,
      unsupported: [...registrations.unsupported, ...movements.unsupported],
    }

    if (result.created > 0 || result.rescheduled > 0 || result.unsupported.length > 0) {
      logger.info(
        {
          jobId: job.id,
          created: result.created,
          rescheduled: result.rescheduled,
          unsupported: result.unsupported.length,
        },
        'compliance.generate',
      )
    }
    if (result.created > 0) {
      await queue.send('compliance.sweep', {}, { singletonKey: 'compliance-sweep' })
    }
  })

  await work('compliance.sweep', async (job) => {
    const due = await listDueObligations({ limit: SWEEP_BATCH })

    for (const obligation of due) {
      await queue.send(
        'compliance.run',
        { propertyId: obligation.propertyId, obligationId: obligation.id },
        // One run per obligation in flight: the lifecycle's conditional writes
        // would make a second harmless, but not free.
        { singletonKey: `compliance:${obligation.id}` },
      )
    }

    if (due.length > 0) logger.info({ jobId: job.id, due: due.length }, 'compliance.sweep')

    // The alert ladder (WP1.5), on the same five-minute beat: inbox, staff,
    // owner, as each deadline nears. The rung is claimed in the database, so a
    // second sweep running alongside sends nothing twice.
    const alerts = await alertDueObligations(compliance, { limit: SWEEP_BATCH, appUrl })
    for (const row of alerts.notificationIds) {
      await queue.send(
        'notification.send',
        { propertyId: row.propertyId, notificationId: row.id },
        { singletonKey: `notify:${row.id}` },
      )
    }
    if (alerts.alerted > 0 || alerts.raced > 0) {
      logger.info(
        {
          jobId: job.id,
          alerted: alerts.alerted,
          messages: alerts.notificationIds.length,
          raced: alerts.raced,
        },
        'compliance.alert',
      )
    }
  })

  await work('compliance.run', async (job) => {
    await stepObligation(job.id, job.data.obligationId)
  })

  /*
   * A person asks the channel to try once more, for a filing handed to them
   * (WP1.2). One attempt; a failure stays with the person, with the reason.
   */
  await work('compliance.retry', async (job) => {
    const { propertyId, obligationId, userId } = job.data
    const result = await retryManualObligation(compliance, { propertyId, obligationId, userId })
    // The status only: a refusal names a guest's field, and logs carry ids.
    logger.info({ jobId: job.id, obligationId, status: result.status }, 'compliance.retry')
    if (result.status === 'acknowledged') {
      await queue.send('documents.purge', {}, { singletonKey: 'documents-purge' })
    }
  })

  /*
   * Yesterday's filings against the channel's side (WP1.2). Changes nothing;
   * a mismatch is an error line and an event for a person to look at.
   */
  await work('alloggiati.reconcile', async (job) => {
    // Without a day, core takes the property's own yesterday, in its zone.
    const result = await reconcileAlloggiatiDay(
      { adapter: alloggiati },
      { propertyId: job.data.propertyId, ...(job.data.day ? { day: job.data.day } : {}) },
    )
    const line = { jobId: job.id, propertyId: job.data.propertyId, ...result }
    if (result.mismatch)
      logger.error(line, 'alloggiati.reconcile: no receipt on the channel for a day we filed')
    else logger.info(line, 'alloggiati.reconcile')
  })

  await work('alloggiati.check', async (job) => {
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

  await work('documents.purge', async (job) => {
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

  await work('receipts.purge', async (job) => {
    if (!deps.deleteReceipt) return
    const { deleted, failed } = await purgeReceiptFiles({ deleteObject: deps.deleteReceipt })
    // Logged whenever it did anything: it destroys files on purpose.
    if (deleted > 0 || failed > 0) {
      logger.info({ jobId: job.id, deleted, failed }, 'receipts.purge')
    }
  })

  /**
   * Answer a guest (E3.2).
   *
   * Queued rather than answered in the request that received the message. The
   * guest's message is stored and visible the moment they press send; the reply
   * arrives when it arrives. A surface that waited for the agent before
   * acknowledging would lose the message entirely if the agent were slow, which
   * is the one outcome worse than a slow answer.
   */
  await work('concierge.reply', async (job) => {
    const { propertyId, reservationId, threadId, locale, message, intent } = job.data

    const outcome = await respondToGuestMessage({
      propertyId,
      reservationId,
      threadId,
      locale,
      message,
      appUrl,
      ...(intent ? { intent } : {}),
    })

    logger.info(
      { jobId: job.id, threadId, outcome: outcome.status, runId: outcome.runId },
      'concierge.reply',
    )

    // A handover reaches the owner's phone now, not at the SLA reminder
    // (plan §4: within 60 s). Phone only: the email is the 30-minute reminder.
    // A paused concierge escalates every message and is excluded — the
    // operator paused it on purpose and the owner would be paged for each one.
    if (outcome.status === 'escalated' || outcome.status === 'failed') {
      await alertEscalation({
        propertyId,
        reservationId,
        threadId,
        escalatedAt: new Date(),
        appUrl,
        reach: 'phone',
      })
    }

    // Anything this turn queued for the property — that alert, or one a
    // complaint tool raised — goes now rather than at the next sweep.
    for (const row of await listPendingNotifications({
      olderThanSeconds: -5,
      limit: SWEEP_BATCH,
      propertyId,
    })) {
      await queue.send(
        'notification.send',
        { propertyId: row.propertyId, notificationId: row.id },
        { singletonKey: `notify:${row.id}` },
      )
    }

    // Whatever the turn wrote — an answer, the handover phrase, the paused
    // acknowledgement — goes to the guest's phone if that is where they wrote
    // from (ADR-035). A no-op for stay-page threads.
    if (messaging && outcome.status !== 'silenced') {
      await queue.send(
        'channel.deliver',
        { propertyId, threadId },
        { singletonKey: `deliver:${threadId}` },
      )
    }

    if (outcome.status === 'escalated' || outcome.status === 'paused') {
      // Nudge the SLA sweep's clock into motion rather than waiting up to its
      // whole interval: the property has a guest waiting from now, not from the
      // next tick.
      await queue.send('escalation.sweep', {}, { singletonKey: 'escalation-sweep' })
    }
  })

  /**
   * Tell someone a guest is still waiting (E3.2 SLA alert).
   *
   * The alert goes to the property, not the guest, and it fires once per
   * escalation — `sla_alerted_at` is what makes that true. An alert that
   * repeated every sweep would be an alert somebody filters.
   */
  await work('escalation.sweep', async (job) => {
    const overdue = await listOverdueEscalations({
      minutes: ESCALATION_SLA_MINUTES,
      limit: SWEEP_BATCH,
      feature: 'inbox',
    })

    for (const thread of overdue) {
      const alerted = await alertEscalation({
        propertyId: thread.propertyId,
        reservationId: thread.reservationId,
        threadId: thread.id,
        escalatedAt: thread.escalatedAt,
        appUrl,
      })

      // Stamped whatever the alert did. A property with no address to reach
      // still has a guest waiting, and retrying an alert we cannot deliver would
      // spin this sweep forever on the same thread.
      await markSlaAlerted(thread.propertyId, thread.id)

      if (alerted) {
        await queue.send('notification.send', {
          propertyId: thread.propertyId,
          notificationId: alerted,
        })
      }
    }

    if (overdue.length > 0) {
      logger.warn({ jobId: job.id, waiting: overdue.length }, 'escalation.sweep')
    }
  })

  /**
   * Finish an arrival (E3.1).
   *
   * Separate from the `arrival.confirm` command that precedes it, because the
   * two fail for unrelated reasons: the command is a state transition that
   * either applies or does not, and this is two network calls to systems that
   * are occasionally down. A retry here re-attempts the side effects without
   * re-asserting a transition that already happened.
   */
  await work('arrival.complete', async (job) => {
    const { propertyId, reservationId, source, userId } = job.data

    const outcome = await completeArrival({
      propertyId,
      reservationId,
      source: source ?? 'staff',
      // Same reasoning as the endpoint that enqueued this: a guest tap has no
      // user behind it and is still not `system`.
      actor: userId
        ? userActor(userId)
        : source === 'guest'
          ? guestActor(reservationId)
          : systemActor,
      pms: adapter,
    })

    logger.info(
      {
        jobId: job.id,
        reservationId,
        source,
        checkInPosted: outcome.checkInPosted,
        ...(outcome.checkInError ? { checkInError: outcome.checkInError } : {}),
      },
      'arrival.complete',
    )

    if (outcome.welcomeNotificationId) {
      await queue.send('notification.send', {
        propertyId,
        notificationId: outcome.welcomeNotificationId,
      })
    }

    // Rethrown so the queue retries the PMS post. The welcome has already been
    // queued by this point, so a retry costs one more call to the PMS and
    // cannot re-send the message — the outbox constraint sees to that.
    if (outcome.checkInError && outcome.checkInError !== 'not reflected to the PMS yet') {
      throw new Error(`check-in post failed: ${outcome.checkInError}`)
    }
  })

  /**
   * Hand an invoice request to the property (E4.1).
   *
   * We issue nothing. This forwards what the guest asked for, unaltered, to the
   * people whose certified chain issues the document (D11, binding rule 6).
   */
  await work('invoice.route', async (job) => {
    const pending = await listUnroutedInvoiceRequests(SWEEP_BATCH)

    for (const request of pending) {
      const notificationId = await queueInvoiceRequestToProperty({
        propertyId: request.propertyId,
        reservationId: request.reservationId,
      })

      await markInvoiceRouted(request.propertyId, request.reservationId)

      if (notificationId) {
        await queue.send('notification.send', {
          propertyId: request.propertyId,
          notificationId,
        })
      }
    }

    if (pending.length > 0) {
      logger.info({ jobId: job.id, routed: pending.length }, 'invoice.route')
    }
  })

  /**
   * Close stays that ended and were never checked out of (E4.1).
   *
   * The backstop for a guest who left at 06:00 without touching their phone.
   * It records `system` as the actor, which is what keeps the express-checkout
   * adoption number honest: a stay closed by a sweep and a stay the guest
   * closed themselves are different facts.
   */
  await work('departure.sweep', async (job) => {
    const departed = await listDepartedStays({ limit: SWEEP_BATCH })

    let closed = 0

    for (const stay of departed) {
      const outcome = await closeDepartedStay({
        propertyId: stay.propertyId,
        reservationId: stay.reservationId,
      })

      if (outcome === 'closed') closed += 1
    }

    if (closed > 0) {
      logger.info({ jobId: job.id, considered: departed.length, closed }, 'departure.sweep')
    }
  })

  /**
   * The tool-boundary audit (E3.2 acceptance criterion, binding rule 7).
   *
   * Runs nightly over what the concierge actually sent. The gate is zero, and
   * a violation is logged at `error` because it is one: it means the product
   * told a guest something about a business that the business never said.
   *
   * It should find nothing — replies are tool phrases by construction. That is
   * the reason to run it. A structural guarantee holds only while the structure
   * does, and the way it stops holding is somebody adding a helpful sentence
   * eighteen months from now.
   */
  await work('toolboundary.audit', async (job) => {
    const since = new Date(Date.now() - AUDIT_WINDOW_HOURS * 3_600_000)
    const properties = await propertiesWithAgentReplies(since)

    let checked = 0
    let violations = 0

    for (const propertyId of properties) {
      const report = await auditToolBoundary({ propertyId, since })

      checked += report.checked
      violations += report.violations.length

      for (const violation of report.violations) {
        logger.error(
          {
            jobId: job.id,
            propertyId,
            kind: violation.kind,
            messageId: violation.messageId,
            threadId: violation.threadId,
            detail: violation.detail,
          },
          'toolboundary.violation',
        )
      }
    }

    logger.info(
      { jobId: job.id, properties: properties.length, checked, violations },
      'toolboundary.audit',
    )
  })

  /**
   * Re-check what we billed at the AI rate (AG-07, E5.4).
   *
   * Runs through the agent runner rather than calling `auditAttribution`
   * directly, and that is not ceremony: it means every night's check leaves an
   * `agent_runs` row with its tool calls and its findings, which is the record
   * an owner's accountant would ask for. An audit nobody can audit is not one.
   *
   * `mode: 'credit'`, so a fee whose evidence no longer holds comes off before
   * the property has to notice. The only direction this agent can move money is
   * down (06 §2).
   */
  await work('attribution.audit', async (job) => {
    const to = new Date()
    const from = new Date(to.getTime() - ATTRIBUTION_AUDIT_WINDOW_DAYS * 86_400_000)

    const properties = await propertiesWithAttributedFees(from, to)

    let checked = 0
    let credited = 0
    let creditedCents = 0

    for (const propertyId of properties) {
      const run = await runAgent({
        agent: 'AG-07',
        propertyId,
        input: { mode: 'credit', from: from.toISOString(), to: to.toISOString() },
      })

      if (run.status === 'rejected') {
        logger.error({ jobId: job.id, propertyId, output: run.output }, 'attribution.audit failed')
        continue
      }

      checked += Number(run.output.checked ?? 0)
      credited += Number(run.output.credited ?? 0)
      creditedCents += Number(run.output.creditedCents ?? 0)

      if (Number(run.output.credited ?? 0) > 0) {
        /*
         * Logged at `warn`, not `info`.
         *
         * A credit means the fee path and the audit path disagreed about a
         * documented rule — which is a bug in one of them, discovered by
         * refunding a customer. It should be uncomfortable to read.
         */
        logger.warn(
          { jobId: job.id, propertyId, credited: run.output.credited, creditedCents },
          'attribution.audit — credited unevidenced fees',
        )
      }
    }

    logger.info(
      { jobId: job.id, properties: properties.length, checked, credited, creditedCents },
      'attribution.audit',
    )
  })

  /**
   * Build last month's statement for every property (E5.4).
   *
   * Builds the draft; it does **not** issue. Issuing is the owner accepting the
   * statement, and a job that froze it on their behalf would turn "accepted" —
   * the word the surface uses — into something nobody actually did.
   *
   * The period is computed per property in that property's own timezone. A
   * single period chosen by whatever enqueued this would put a midnight booking
   * in the wrong month for any house outside the scheduler's zone.
   */
  await work('report.generate', async (job) => {
    const rows = await listPropertiesForReports()

    let built = 0

    for (const property of rows) {
      const period = previousPeriod(property.timezone)
      const report = await buildReport({ propertyId: property.id, periodStart: period })

      if (!report) continue

      built += 1

      logger.info(
        {
          jobId: job.id,
          propertyId: property.id,
          period,
          totalCents: report.totalCents,
          status: report.status,
        },
        'report.generate',
      )
    }

    logger.info({ jobId: job.id, properties: rows.length, built }, 'report.generate')
  })

  /**
   * Draft a property's knowledge base from its own website (AG-03, E7.1).
   *
   * Through the runner, so the scrape leaves an `agent_runs` row: what was
   * fetched, what was found, what was written. An owner asking "where did this
   * answer come from" gets an answer, and so does anyone reviewing whether the
   * extraction is worth its KPI (06 §2: ≥70% accepted without edits).
   *
   * Everything it writes is unpublished. There is no tool granted that could
   * publish one, so a failure here costs an owner nothing and reaches no guest.
   */
  await work('onboarding.ingest', async (job) => {
    const { propertyId, url, locale } = job.data

    const run = await runAgent({
      agent: 'AG-03',
      propertyId,
      locale,
      input: { url },
    })

    logger.info(
      {
        jobId: job.id,
        propertyId,
        outcome: run.status,
        fetched: run.output.fetched ?? false,
        written: run.output.written ?? 0,
        skipped: run.output.skipped ?? 0,
      },
      'onboarding.ingest',
    )
  })

  /**
   * Erasure (E8.1).
   *
   * A job rather than a synchronous call, for three reasons that all point the
   * same way: it deletes objects from storage, which can fail on somebody
   * else's service; it is irreversible, so a retry has to be safe rather than
   * fast; and the owner who pressed it has already been told it is a two-step
   * operation. `eraseGuest` is written so that every interruption leaves a
   * state more erased than before, which is what makes the retry safe.
   *
   * The request row is resolved only after the erasure returns. A request
   * marked complete by a job that then failed is the one outcome nobody could
   * detect afterwards — the data would be half-gone and the deadline evidence
   * would say it was handled.
   */
  await work('privacy.erase', async (job) => {
    const { propertyId, guestId, requestId, userId } = job.data

    const outcome = await eraseGuest(
      { deleteObject },
      { propertyId, guestId, actor: userId ? userActor(userId) : systemActor },
    )

    if (requestId) {
      await resolveRequest({
        propertyId,
        requestId,
        status: 'completed',
        // Counts and carve-out names. This is read back to the data subject as
        // the written response Art. 12 requires, so it has to be safe to hand
        // over — see the schema comment on `privacy_requests.outcome`.
        outcome: {
          applied: outcome.applied,
          documents: outcome.documents,
          carveOuts: outcome.carveOuts,
        },
        actor: userId ? userActor(userId) : systemActor,
      })
    }

    logger.info(
      {
        jobId: job.id,
        propertyId,
        // Never the guest's details. A log line is a copy of the thing we were
        // just asked to destroy, and it lives outside every retention rule.
        tables: Object.keys(outcome.applied).length,
        documents: outcome.documents,
      },
      'privacy.erase',
    )
  })

  /**
   * The retention sweep (E8.2).
   *
   * One property per job, driven by the data map. It reports per rule rather
   * than as a single number so that a rule which starts failing — a column
   * renamed, a constraint added — is visible as itself instead of as a total
   * that is quietly lower than last night's.
   */
  await work('retention.sweep', async (job) => {
    const { propertyId } = job.data

    const outcome = await runRetention({ propertyId })
    const failed = outcome.results.filter((result) => result.error)

    if (failed.length > 0) {
      // Warn rather than throw: the rules that did run were applied, and
      // failing the job would retry all of them, including the ones that
      // already deleted what they were meant to.
      logger.warn({ jobId: job.id, propertyId, failed }, 'retention.sweep had failing rules')
    }

    if (outcome.total > 0 || failed.length > 0) {
      logger.info(
        {
          jobId: job.id,
          propertyId,
          total: outcome.total,
          rules: outcome.results.filter((result) => result.affected > 0),
        },
        'retention.sweep',
      )
    }
  })

  await work('reservation.expire_holds', async (job) => {
    const { expired } = await expireHolds()

    if (expired > 0) {
      logger.info({ jobId: job.id, expired }, 'reservation.expire_holds')
    }
  })

  /**
   * Read one guest's document with the vision model (WP0.4).
   *
   * Gated by `document_ocr` in the wrapper. Skips quietly without a registered
   * model, without a stored image, or for a PDF (the model reads images). What
   * is logged is whether the MRZ checked out — never a field from the document.
   */
  await work('documents.extract', async (job) => {
    const { propertyId, reservationId, guestIndex } = job.data
    const llm = listProviders()[0]
    if (!llm || !deps.readObject) {
      logger.info(
        { jobId: job.id, propertyId },
        'documents.extract skipped: no model or no storage',
      )
      return
    }

    const path = await getDocumentPath(propertyId, reservationId, guestIndex)
    if (!path) return

    const image = await deps.readObject(path)
    if (!image || !image.mediaType.startsWith('image/')) {
      logger.info(
        { jobId: job.id, propertyId, mediaType: image?.mediaType ?? null },
        'documents.extract skipped: not an image',
      )
      return
    }

    const reading = await readDocument(llm, image)
    await recordDocumentReading({ propertyId, reservationId, guestIndex, reading })

    logger.info(
      {
        jobId: job.id,
        propertyId,
        reservationId,
        guestIndex,
        source: reading.source,
        mrzValid: reading.mrz.valid,
      },
      'documents.extract',
    )
  })

  /**
   * Complaint SLA breaches (WP0.6): an open complaint past its deadline tells
   * the manager, once. A complaint with no conversation still gets stamped, so
   * it is not re-found every sweep; it stays loud in the console either way.
   */
  await work('complaints.sla', async (job) => {
    const breached = await listBreachedComplaints(SWEEP_BATCH)

    for (const complaint of breached) {
      if (complaint.threadId) {
        await alertEscalation({
          propertyId: complaint.propertyId,
          reservationId: complaint.reservationId,
          threadId: complaint.threadId,
          escalatedAt: complaint.slaDueAt,
          appUrl,
        })
      }
      await markComplaintBreachAlerted(complaint.propertyId, complaint.id)
    }

    if (breached.length > 0)
      logger.info({ jobId: job.id, breached: breached.length }, 'complaints.sla')
  })

  /**
   * The owner's question from the console (AG-06, WP0.7). Read-only tools; the
   * answer is the run's own output, which the console reads back.
   */
  await work('owner.ask', async (job) => {
    const { propertyId, userId, message, locale, requestId } = job.data
    const run = await runAgent({
      agent: 'AG-06',
      propertyId,
      locale,
      input: { message, askedBy: userId },
      ...(requestId ? { inputRef: requestId } : {}),
    })
    logger.info({ jobId: job.id, propertyId, runId: run.runId, status: run.status }, 'owner.ask')
  })

  /**
   * Send a thread's pending replies on WhatsApp/SMS (ADR-035). Whoever wrote
   * them — the concierge, a person, the product — this is the one place a
   * reply leaves for a phone.
   */
  await work('channel.deliver', async (job) => {
    const { propertyId, threadId } = job.data
    if (!messaging) return

    const target = await channelTarget(propertyId, threadId)
    if (!target) return
    if (!(await isEntitled(propertyId, target.channel))) {
      logger.info({ jobId: job.id, propertyId, channel: target.channel }, 'skipped: channel off')
      return
    }

    const pending = await pendingReplies(propertyId, threadId, messaging.provider.name)
    if (pending.length === 0) return

    if (!target.withinWindow) {
      // Free text after 24 hours is refused by WhatsApp; it needs a template.
      // Left pending and visible in the console rather than sent to fail.
      logger.warn(
        { jobId: job.id, threadId, pending: pending.length },
        'channel.deliver: outside window',
      )
      return
    }

    for (const reply of pending) {
      try {
        const sent = await messaging.provider.send({
          channel: target.channel,
          to: target.to,
          subject: null,
          body: reply.body,
          locale: 'it',
        })
        await recordDelivery({
          propertyId,
          threadId,
          messageId: reply.messageId,
          provider: messaging.provider.name,
          providerMessageId: sent.providerMessageId ?? `unknown:${reply.messageId}`,
          channel: target.channel,
        })
      } catch (error) {
        if (messaging.retryable(error)) throw error
        await recordDeliveryFailure({
          propertyId,
          threadId,
          messageId: reply.messageId,
          provider: messaging.provider.name,
          channel: target.channel,
          reason: error instanceof Error ? error.message : String(error),
        })
        logger.warn(
          { jobId: job.id, threadId, messageId: reply.messageId },
          'channel.deliver: refused',
        )
      }
    }
  })

  /** Catches replies written outside a concierge turn (ADR-035). */
  await work('channel.sweep', async () => {
    if (!messaging) return
    for (const { propertyId, threadId } of await threadsWithPendingReplies(
      messaging.provider.name,
    )) {
      await queue.send(
        'channel.deliver',
        { propertyId, threadId },
        { singletonKey: `deliver:${threadId}` },
      )
    }
  })

  /** A sender who is neither the owner nor a current guest (ADR-035). */
  await work('channel.unmatched', async (job) => {
    const { propertyId, channel, to, locale } = job.data
    if (!messaging || !(await isEntitled(propertyId, channel))) return

    const property = await getPropertyBasics(propertyId)
    if (!property) return
    await messaging.provider.send({
      channel,
      to,
      subject: null,
      body: unmatchedSenderPhrase(
        locale,
        property.name,
        `${appUrl.replace(/\/$/, '')}/${locale}/book/${property.slug}`,
      ),
      locale,
    })
  })

  /** Twilio's copy of a finished message goes (ADR-035). */
  await work('channel.purge', async (job) => {
    if (!messaging) return
    try {
      await messaging.purge(job.data.providerMessageId)
    } catch (error) {
      if (messaging.retryable(error)) throw error
      logger.warn({ jobId: job.id }, 'channel.purge: refused')
    }
  })

  /**
   * The owner wrote to the property's number (AG-06, ADR-035). `respondToOwner`
   * checks the number against the recorded owner phones again: the webhook's
   * routing is not the only thing standing between a guest and this agent.
   */
  await work('owner.message', async (job) => {
    const { propertyId, channel, phone, message, locale } = job.data
    if (!messaging || !(await isEntitled(propertyId, channel))) return

    const outcome = await respondToOwner({ propertyId, phone, message, locale })
    if (outcome.status === 'refused') {
      logger.warn({ jobId: job.id, propertyId }, 'owner.message refused')
      return
    }
    await messaging.provider.send({
      channel,
      to: phone,
      subject: null,
      body: outcome.status === 'answered' ? outcome.reply : ownerNotUnderstoodPhrase(locale),
      locale,
    })
    logger.info(
      { jobId: job.id, propertyId, runId: outcome.runId, status: outcome.status },
      'owner.message',
    )
  })

  /**
   * A console preview of the concierge (ADR-038): the same orchestrator,
   * profiles, rules and model as a guest gets, with every tool that is not
   * read-only simulated by the runner. No thread, so no message, no escalation
   * and no alert. Who tried it is recorded as an event.
   */
  await work('agent.preview', async (job) => {
    const { propertyId, userId, message, locale, requestId, reservationId } = job.data

    const facts = reservationId ? await getReservationFacts(propertyId, reservationId) : null

    const run = await runAgent({
      agent: 'AG-01',
      propertyId,
      locale,
      appUrl,
      preview: true,
      inputRef: requestId,
      // Only a stay the property actually holds; anything else previews as a
      // guest without a booking.
      ...(facts && reservationId ? { reservationId } : {}),
      input: {
        message,
        history: [],
        hasBooking: Boolean(facts),
        ...(facts?.businessHours ? { businessHours: facts.businessHours } : {}),
      },
    })

    await recordPreview({ propertyId, userId, runId: run.runId })
    logger.info(
      { jobId: job.id, propertyId, runId: run.runId, status: run.status },
      'agent.preview',
    )
  })

  /** Re-derive per-property schedules from properties and entitlements (ADR-019). */
  await work('schedules.sync', async (job) => {
    const outcome = await syncPropertySchedules({ queue, logger, features: featureCheck() })

    if (outcome.removed > 0) {
      logger.info({ jobId: job.id, ...outcome }, 'schedules.sync')
    }
  })
}
