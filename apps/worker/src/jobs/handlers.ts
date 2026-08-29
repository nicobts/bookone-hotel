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
import {
  alertEscalation,
  auditToolBoundary,
  listOverdueEscalations,
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
import { guestActor, systemActor, userActor } from '@bookone/core/events'
import { runAgent } from '@bookone/agents/runner'
import { respondToGuestMessage } from '@bookone/agents/concierge'
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
  /**
   * The public base URL, for links a guest or an owner will click.
   *
   * Injected rather than read from the environment here, like every other
   * dependency in this file: a handler that reaches for `process.env` is a
   * handler that cannot be tested without one.
   */
  appUrl: string
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

  /**
   * Answer a guest (E3.2).
   *
   * Queued rather than answered in the request that received the message. The
   * guest's message is stored and visible the moment they press send; the reply
   * arrives when it arrives. A surface that waited for the agent before
   * acknowledging would lose the message entirely if the agent were slow, which
   * is the one outcome worse than a slow answer.
   */
  await queue.work('concierge.reply', async (job) => {
    const { propertyId, reservationId, threadId, locale, message, intent } = job.data

    const outcome = await respondToGuestMessage({
      propertyId,
      reservationId,
      threadId,
      locale,
      message,
      ...(intent ? { intent } : {}),
    })

    logger.info(
      { jobId: job.id, threadId, outcome: outcome.status, runId: outcome.runId },
      'concierge.reply',
    )

    if (outcome.status === 'escalated') {
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
  await queue.work('escalation.sweep', async (job) => {
    const overdue = await listOverdueEscalations({
      minutes: ESCALATION_SLA_MINUTES,
      limit: SWEEP_BATCH,
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
  await queue.work('arrival.complete', async (job) => {
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
  await queue.work('invoice.route', async (job) => {
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
  await queue.work('departure.sweep', async (job) => {
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
  await queue.work('toolboundary.audit', async (job) => {
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
  await queue.work('attribution.audit', async (job) => {
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
  await queue.work('report.generate', async (job) => {
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

  await queue.work('reservation.expire_holds', async (job) => {
    const { expired } = await expireHolds()

    if (expired > 0) {
      logger.info({ jobId: job.id, expired }, 'reservation.expire_holds')
    }
  })
}
