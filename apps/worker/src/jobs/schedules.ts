import { asService, properties } from '@bookone/core/db'
import type { JobName, JobQueue } from '@bookone/core/jobs'
import {
  createFeatureCheck,
  gateOpen,
  JOB_FEATURE,
  type FeatureCheck,
} from '@bookone/core/onboarding'
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

/**
 * The pre-arrival invitation sweep (E2.1).
 *
 * Hourly, not by-the-minute: T-48h is an approximate moment by nature, and an
 * email that arrives within an hour of it is indistinguishable to a guest from
 * one that arrives on the minute. Hourly also means the sweep is cheap enough
 * to keep running when nothing is due, which is most hours.
 */
const PRECHECKIN_SWEEP = '7 * * * *'

/**
 * Chases acknowledgements the channel has not returned yet (E2.3).
 *
 * Every ten minutes. Only meaningful for a channel that queues — Alloggiati Web
 * acknowledges on upload — and the channel is not chosen yet, so it has to be
 * correct for both.
 */
const ALLOGGIATI_CHECK = '*/10 * * * *'

/**
 * Destroys identity documents whose filing was acknowledged (E2.4).
 *
 * Hourly. Nothing about the guest's experience depends on it running sooner,
 * and it deletes personal data — a job like that should be predictable rather
 * than eager.
 */
const DOCUMENT_PURGE = '23 * * * *'

/**
 * Checks whether anybody has answered an escalated guest (E3.2).
 *
 * Every five minutes. The alert fires once per escalation — `sla_alerted_at`
 * enforces that — so the cadence only decides how *late* the alert can be,
 * which is at most five minutes past the thirty-minute window. Running it
 * minutely would buy four minutes on an alert going to a phone in an apron
 * pocket, which is not four minutes anybody gains.
 */
const ESCALATION_SWEEP = '*/5 * * * *'

/**
 * Hands queued invoice requests to the property (E4.1).
 *
 * Every ten minutes. A guest requesting an invoice at checkout is not waiting
 * at the desk for it — they asked so they could leave — and the property issues
 * it on their own schedule. What matters is that the request cannot sit
 * unrouted overnight.
 */
const INVOICE_ROUTE = '*/10 * * * *'

/**
 * Replies bound for WhatsApp/SMS that no concierge turn sent: a staff reply,
 * an approval decided later (ADR-035). Every minute, so a person's answer
 * reaches the guest's phone about as fast as it reaches the stay page.
 */
const CHANNEL_SWEEP = '* * * * *'

/**
 * Closes stays that ended and nobody checked out of (E4.1).
 *
 * 04:30, an hour after reconciliation, so a stay is closed against a picture
 * the night's sync has already agreed on. Same reasoning as the 03:30 choice:
 * doing this while a system is still being typed into produces work for
 * somebody in the morning.
 */
const DEPARTURE_SWEEP = '30 4 * * *'

/**
 * Re-reads what the concierge said against what its tools returned (E3.2).
 *
 * 05:00, after the night's other work, because it is a report rather than a
 * repair — nothing waits on it. Daily rather than continuous for the same
 * reason: it should find nothing, and a check that runs constantly and finds
 * nothing is a check nobody reads the output of.
 */
const TOOLBOUNDARY_AUDIT = '0 5 * * *'

/**
 * Re-checks AI-attributed fees against their evidence (AG-07, E5.4).
 *
 * 05:30, after the tool-boundary audit and before anybody opens the console.
 * Daily rather than monthly, deliberately: finding a fee we should not have
 * billed on the day it happens is a correction, and finding it on the 1st is a
 * month of an owner having been overcharged.
 */
const ATTRIBUTION_AUDIT = '30 5 * * *'

/**
 * Builds last month's statement for every property (E5.4).
 *
 * 06:00 on the 2nd, not the 1st. A booking confirmed at 23:50 on the last night
 * of the month has a fee, a reflection and possibly a webhook still in flight;
 * building the statement an hour later would produce a draft that changes when
 * the queue drains — on the one screen whose whole value is not changing.
 *
 * It builds a draft and stops. Issuing is the owner accepting it.
 */
const REPORT_GENERATE = '0 6 2 * *'

/**
 * The retention sweep, per property (E8.2).
 *
 * 02:15, deliberately outside the 03:30–06:00 band the rest of the night's work
 * occupies. Nothing in that band reads data old enough for this to touch, so
 * the ordering is not a correctness requirement — it is so that a sweep which
 * one day takes twenty minutes cannot delay the parity measurement that D11's
 * condition C2 turns on.
 *
 * Daily rather than weekly because the periods it enforces are declared to the
 * day. "We keep messages for 24 months" and "we keep them for 24 months and up
 * to six more days" are different statements, and only one of them is in the
 * data map.
 */
const RETENTION_SWEEP = '15 2 * * *'

/**
 * How often per-property schedules are re-derived (ADR-019).
 *
 * Ten minutes is the longest an owner waits between a feature being granted or
 * revoked and its nightly work starting or stopping. The gated handlers refuse
 * a revoked property's work immediately regardless; this only decides whether
 * the schedule still fires into that refusal.
 */
const SCHEDULES_SYNC = '*/10 * * * *'

/** Complaint SLA breaches: every two minutes, because the shortest SLA is five (WP0.6). */
const COMPLAINTS_SLA = '*/2 * * * *'

/** The per-property schedules, and what each one is for. */
const PER_PROPERTY = [
  'reconcile.nightly',
  'availability.refresh',
  'retention.sweep',
] as const satisfies readonly JobName[]

export interface ScheduleDeps {
  queue: JobQueue
  logger: Pick<Logger, 'info'>
  /** Defaults to reading entitlements. Injected so the test needs no database. */
  features?: FeatureCheck
  /** Defaults to every property. Injected for the same reason. */
  listProperties?: () => Promise<{ id: string }[]>
}

async function allProperties(): Promise<{ id: string }[]> {
  return asService((db) => db.select({ id: properties.id }).from(properties))
}

/**
 * Bring every per-property schedule in line with the properties that exist and
 * the features they have.
 *
 * Idempotent: `schedule` upserts by name and key, and anything that should no
 * longer fire is removed. Run at boot and then by `schedules.sync`, which also
 * retires the old "a new property waits for a restart" caveat and moves the
 * availability window forward with the calendar instead of freezing it at boot.
 */
export async function syncPropertySchedules(
  deps: ScheduleDeps,
): Promise<{ scheduled: number; removed: number }> {
  const { queue, logger } = deps
  const features = deps.features ?? createFeatureCheck()
  const rows = await (deps.listProperties ?? allProperties)()

  const today = new Date()
  const horizon = new Date(today.getTime() + AVAILABILITY_HORIZON_DAYS * 86_400_000)

  const live: Record<(typeof PER_PROPERTY)[number], Set<string>> = {
    'reconcile.nightly': new Set(),
    'availability.refresh': new Set(),
    'retention.sweep': new Set(),
  }

  for (const property of rows) {
    if (await gateOpen(features, property.id, JOB_FEATURE['reconcile.nightly'])) {
      await queue.schedule(
        'reconcile.nightly',
        NIGHTLY_RECONCILE,
        { propertyId: property.id, domain: 'booking' },
        { key: property.id },
      )
      live['reconcile.nightly'].add(property.id)
    }

    // The payload carries the window, and a cron payload is stored once — so
    // each sync rewrites it, and the window rolls forward with the calendar.
    if (await gateOpen(features, property.id, JOB_FEATURE['availability.refresh'])) {
      await queue.schedule(
        'availability.refresh',
        AVAILABILITY_REFRESH,
        { propertyId: property.id, from: isoDate(today), to: isoDate(horizon) },
        { key: property.id },
      )
      live['availability.refresh'].add(property.id)
    }

    if (await gateOpen(features, property.id, JOB_FEATURE['retention.sweep'])) {
      await queue.schedule(
        'retention.sweep',
        RETENTION_SWEEP,
        { propertyId: property.id },
        { key: property.id },
      )
      live['retention.sweep'].add(property.id)
    }
  }

  // Remove schedules that no longer correspond to a property with the feature.
  //
  // Schedules outlive the process that created them, so without this the set
  // only ever grows: a property removed keeps being reconciled, and — the case
  // that actually happened here — a keyless schedule written by an older build
  // keeps firing alongside the keyed ones, refreshing one property twice and
  // making the log look like the fix did not work.
  let removed = 0

  for (const name of PER_PROPERTY) {
    for (const schedule of await queue.listSchedules(name)) {
      if (live[name].has(schedule.key)) continue

      await queue.unschedule(name, schedule.key)
      removed += 1
      logger.info({ job: name, key: schedule.key }, 'removed a schedule')
    }
  }

  const scheduled = PER_PROPERTY.reduce((sum, name) => sum + live[name].size, 0)
  return { scheduled, removed }
}

export async function registerSchedules(deps: ScheduleDeps): Promise<void> {
  const { queue, logger } = deps

  const perProperty = await syncPropertySchedules(deps)

  // Cross-property maintenance. Scheduled once, and therefore needing no key:
  // a hold that expired at a property this loop never reached is exactly the
  // hold that needs expiring. The gated ones among them skip properties without
  // their feature inside the sweep (ADR-019).
  await queue.schedule('reservation.expire_holds', EXPIRE_HOLDS, {})
  await queue.schedule('notification.sweep', NOTIFICATION_SWEEP, {})
  await queue.schedule('payment.replay', PAYMENT_REPLAY, {})
  await queue.schedule('precheckin.sweep', PRECHECKIN_SWEEP, {})
  await queue.schedule('alloggiati.check', ALLOGGIATI_CHECK, {})
  await queue.schedule('documents.purge', DOCUMENT_PURGE, {})
  await queue.schedule('escalation.sweep', ESCALATION_SWEEP, {})
  await queue.schedule('invoice.route', INVOICE_ROUTE, {})
  await queue.schedule('departure.sweep', DEPARTURE_SWEEP, {})
  await queue.schedule('toolboundary.audit', TOOLBOUNDARY_AUDIT, {})
  await queue.schedule('attribution.audit', ATTRIBUTION_AUDIT, {})
  await queue.schedule('report.generate', REPORT_GENERATE, {})
  await queue.schedule('schedules.sync', SCHEDULES_SYNC, {})
  await queue.schedule('complaints.sla', COMPLAINTS_SLA, {})
  await queue.schedule('channel.sweep', CHANNEL_SWEEP, {})

  logger.info(
    {
      perPropertySchedules: perProperty.scheduled,
      removed: perProperty.removed,
      reconcile: NIGHTLY_RECONCILE,
      availability: AVAILABILITY_REFRESH,
      expireHolds: EXPIRE_HOLDS,
      notificationSweep: NOTIFICATION_SWEEP,
      paymentReplay: PAYMENT_REPLAY,
      precheckinSweep: PRECHECKIN_SWEEP,
      alloggiatiCheck: ALLOGGIATI_CHECK,
      documentPurge: DOCUMENT_PURGE,
      schedulesSync: SCHEDULES_SYNC,
    },
    'schedules registered',
  )
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
