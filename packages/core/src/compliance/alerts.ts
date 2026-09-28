import { z } from 'zod'
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { complianceObligations, guests, properties, reservations } from '../db/schema'
import { emit } from '../events'
import { systemActor } from '../events/actor'
import { isEntitled } from '../onboarding/entitlements'
import { phoneChannelFor, readPhones } from '../concierge/alerts'
import { COMPLIANCE_ALERT, queueNotification, type ComplianceAlertFacts } from '../notifications'
import { ALERTING_STATES, type ObligationState } from './lifecycle'
import type { ComplianceDeps } from './obligations'

/**
 * The deadline alert ladder (Guest Desk WP1.5).
 *
 * An obligation nobody has filed yet climbs three rungs as its deadline nears:
 *
 *   1. **inbox** — it appears in the console's exceptions inbox;
 *   2. **staff** — the numbers in `settings.staffPhones` get a WhatsApp (or SMS);
 *   3. **owner** — the numbers in `settings.ownerPhones` get one too.
 *
 * Each rung has an offset before the deadline, per property
 * (`settings.complianceAlerts`), defaulting to 12, 6 and 3 hours. An obligation
 * handed to a person (`manual`) goes straight to the staff rung: it will not
 * file itself, so waiting for the clock would only use up the time they have.
 *
 * Two rules, both from the spec:
 *
 * - **Nothing fires twice.** The rung reached is stored on the obligation and
 *   only raised by a conditional update from the value read. Two sweeps
 *   racing, a retried job, a restarted worker: one of them wins the update and
 *   the others send nothing.
 * - **Escalation before expiry, never after.** No rung starts once the deadline
 *   has passed. A breach is not an alert; the obligation stays in the inbox,
 *   where the fallback file is.
 *
 * Alerts only while the obligation is not with the authority: `submitted` and
 * `acknowledged` are the channel's and the authority's, and paging someone
 * about a filing that has already gone would teach them to ignore the page.
 */

export const ALERT_REACHES = ['inbox', 'staff', 'owner'] as const
export type AlertReach = (typeof ALERT_REACHES)[number]

/** Rung numbers as stored in `alert_rung`: the index in `ALERT_REACHES` plus one. */
export function rungOf(reach: AlertReach): number {
  return ALERT_REACHES.indexOf(reach) + 1
}

/** Minutes before the deadline at which each rung fires; null switches a rung off. */
export type AlertLadder = Record<AlertReach, number | null>

export const DEFAULT_ALERT_LADDER: AlertLadder = { inbox: 12 * 60, staff: 6 * 60, owner: 3 * 60 }

const minutes = z
  .number()
  .int()
  .min(1)
  .max(24 * 60)
  .nullable()

type PartialLadder = Partial<Record<AlertReach, number | null | undefined>>

/** A partial ladder over the defaults; a key left out keeps its default. */
function withDefaults(partial: PartialLadder): AlertLadder {
  const ladder = { ...DEFAULT_ALERT_LADDER }
  for (const reach of ALERT_REACHES) {
    const value = partial[reach]
    if (value !== undefined) ladder[reach] = value
  }
  return ladder
}

const ladderSchema = z
  .object({ inbox: minutes, staff: minutes, owner: minutes })
  .partial()
  .strict()
  .refine(
    (ladder) => {
      // Each rung no earlier than the one below it: an owner paged before the
      // staff who could have handled it is the wrong way round.
      const merged = withDefaults(ladder)
      const on = ALERT_REACHES.map((reach) => merged[reach]).filter(
        (value): value is number => value !== null,
      )
      return on.every((value, i) => i === 0 || value <= on[i - 1]!)
    },
    { message: 'Later rungs must fire closer to the deadline than earlier ones.' },
  )

/**
 * The property's ladder from `settings.complianceAlerts`, over the defaults.
 * A setting that does not validate falls back to the defaults entirely, rather
 * than half-applying: a typo must never switch the alerts off.
 */
export function readAlertLadder(settings: unknown): AlertLadder {
  const raw = (settings as { complianceAlerts?: unknown } | null)?.complianceAlerts
  if (raw === undefined || raw === null) return { ...DEFAULT_ALERT_LADDER }
  const parsed = ladderSchema.safeParse(raw)
  return parsed.success ? withDefaults(parsed.data) : { ...DEFAULT_ALERT_LADDER }
}

/** Whether a proposed ladder is valid, for the settings form and the tests. */
export function validateAlertLadder(value: unknown): { ok: true } | { ok: false; message: string } {
  const parsed = ladderSchema.safeParse(value)
  return parsed.success
    ? { ok: true }
    : { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid alert ladder.' }
}

/**
 * The highest rung due for an obligation at `now`, 0 when none. Pure: the
 * fake-clock tests drive this and `alertsToFire` directly.
 */
export function dueRung(
  obligation: { state: ObligationState; deadline: Date },
  ladder: AlertLadder,
  now: Date,
): number {
  if (!ALERTING_STATES.includes(obligation.state)) return 0
  // Never after expiry.
  if (now.getTime() >= obligation.deadline.getTime()) return 0

  let rung = 0
  for (const reach of ALERT_REACHES) {
    const offset = ladder[reach]
    if (offset === null) continue
    if (now.getTime() >= obligation.deadline.getTime() - offset * 60_000) rung = rungOf(reach)
  }

  if (obligation.state === 'manual') {
    // With a person now: at least the first phone rung that is switched on.
    const phone = (['staff', 'owner'] as const).find((reach) => ladder[reach] !== null)
    rung = Math.max(rung, phone ? rungOf(phone) : rungOf('inbox'))
  }

  return rung
}

/**
 * The rungs to fire when an obligation at `current` is due at `due`: every rung
 * in between that is switched on. A late start — an obligation created three
 * hours before its deadline — fires staff and owner together, because both
 * would have been told by now.
 */
export function alertsToFire(current: number, due: number, ladder: AlertLadder): AlertReach[] {
  return ALERT_REACHES.filter(
    (reach) => rungOf(reach) > current && rungOf(reach) <= due && ladder[reach] !== null,
  )
}

/**
 * Whether an obligation was handed to a person (`manual`) after its last alert,
 * so nobody has yet been told it must be filed by hand. `alertedAt` is written
 * no earlier than the hand-over, so one claim clears it.
 */
export function handoverPending(obligation: {
  state: ObligationState
  alertedAt: Date | null
  stateChangedAt: Date
}): boolean {
  return (
    obligation.state === 'manual' &&
    (obligation.alertedAt === null ||
      obligation.alertedAt.getTime() < obligation.stateChangedAt.getTime())
  )
}

/**
 * The rungs to fire for a hand-over: the ordinary rise, plus every phone rung
 * already fired. Those people were told the filing would go by itself; the
 * hand-over is new news to them. The inbox is never repeated.
 */
export function handoverToFire(current: number, due: number, ladder: AlertLadder): AlertReach[] {
  const top = Math.max(current, due)
  return ALERT_REACHES.filter(
    (reach) =>
      ladder[reach] !== null &&
      rungOf(reach) <= top &&
      (reach !== 'inbox' || rungOf(reach) > current),
  )
}

export interface AlertSweepResult {
  /** Obligations whose rung rose. */
  alerted: number
  /** Notifications queued, for the worker to send now. */
  notificationIds: { id: string; propertyId: string }[]
  /** Another sweep claimed the rung first. */
  raced: number
}

/**
 * One pass of the ladder over every open obligation near its deadline.
 *
 * Reads candidates across properties under the service role and scopes every
 * write by the obligation's own property (ADR-007). The largest offset a ladder
 * may hold is 24 hours, so nothing further out is read.
 */
export async function alertDueObligations(
  deps: ComplianceDeps,
  input: { limit: number; appUrl: string; now?: Date },
): Promise<AlertSweepResult> {
  const now = input.now ?? deps.now?.() ?? new Date()
  const horizon = new Date(now.getTime() + 24 * 60 * 60_000)
  // Timestamps round-trip through JavaScript at millisecond precision; compare
  // the hand-over at the same precision, or a database default's microseconds
  // would keep it pending after its claim.
  const handoverCutoff = sql`date_trunc('milliseconds', ${complianceObligations.stateChangedAt})`

  const candidates = await asService((db) =>
    db
      .select({
        id: complianceObligations.id,
        propertyId: complianceObligations.propertyId,
        adapterId: complianceObligations.adapterId,
        authority: complianceObligations.authority,
        reservationId: complianceObligations.reservationId,
        periodDate: complianceObligations.periodDate,
        state: complianceObligations.state,
        deadline: complianceObligations.deadline,
        alertRung: complianceObligations.alertRung,
        alertedAt: complianceObligations.alertedAt,
        stateChangedAt: complianceObligations.stateChangedAt,
        settings: properties.settings,
        slug: properties.slug,
        timeZone: properties.timezone,
        locale: properties.localeDefault,
      })
      .from(complianceObligations)
      .innerJoin(properties, eq(properties.id, complianceObligations.propertyId))
      .where(
        and(
          inArray(complianceObligations.state, [...ALERTING_STATES]),
          gt(complianceObligations.deadline, now),
          lte(complianceObligations.deadline, horizon),
          or(
            lt(complianceObligations.alertRung, rungOf('owner')),
            // A hand-over after the last rung fired still pages (see below).
            and(
              eq(complianceObligations.state, 'manual'),
              or(
                isNull(complianceObligations.alertedAt),
                lt(complianceObligations.alertedAt, handoverCutoff),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(complianceObligations.deadline))
      .limit(input.limit),
  )

  const result: AlertSweepResult = { alerted: 0, notificationIds: [], raced: 0 }
  const entitled = new Map<string, boolean>()

  for (const row of candidates) {
    const ladder = readAlertLadder(row.settings)
    const handover = handoverPending(row)
    const due = Math.max(dueRung(row, ladder, now), row.alertRung)
    // A hand-over is its own news: the filing usually goes to a person inside
    // the last margin, after the staff and owner rungs have fired, and they were
    // told it would file itself.
    if (due <= row.alertRung && !handover) continue

    // Off means off (ADR-019): a property whose filing feature was switched
    // off after the obligation was created is not paged about it.
    const feature = deps.adapters.get(row.adapterId)?.capabilities().feature
    if (!feature) continue
    const gateKey = `${row.propertyId}:${feature}`
    if (!entitled.has(gateKey)) entitled.set(gateKey, await isEntitled(row.propertyId, feature))
    if (!entitled.get(gateKey)) continue

    const reaches = handover
      ? handoverToFire(row.alertRung, due, ladder)
      : alertsToFire(row.alertRung, due, ladder)
    // Never earlier than the hand-over it answers, so the claim clears it.
    const alertedAt = new Date(Math.max(now.getTime(), row.stateChangedAt.getTime()))

    const outcome = await asService((db) =>
      db.transaction(async (tx) => {
        const claimed = await tx
          .update(complianceObligations)
          .set({ alertRung: due, alertedAt })
          .where(
            and(
              eq(complianceObligations.id, row.id),
              eq(complianceObligations.propertyId, row.propertyId),
              eq(complianceObligations.alertRung, row.alertRung),
              // The hand-over claim: the rung may not move, so the timestamp
              // read is what two sweeps race on.
              row.alertedAt === null
                ? isNull(complianceObligations.alertedAt)
                : eq(complianceObligations.alertedAt, row.alertedAt),
              inArray(complianceObligations.state, [...ALERTING_STATES]),
            ),
          )
          .returning({ id: complianceObligations.id })

        if (claimed.length === 0) return null

        const phoneReaches = reaches.filter((reach) => reach !== 'inbox')
        const channel = phoneReaches.length > 0 ? await phoneChannelFor(tx, row.propertyId) : null

        const facts = channel ? await alertFacts(tx, row, input.appUrl) : null

        const queued: string[] = []
        let unreachable = 0
        for (const reach of phoneReaches) {
          const phones = channel
            ? readPhones(row.settings, reach === 'staff' ? 'staffPhones' : 'ownerPhones')
            : []
          if (phones.length === 0) unreachable += 1
          for (const phone of phones) {
            // Not scoped to the reservation: the outbox's per-stay dedupe
            // would drop the owner's message after the staff's. The once-only
            // guarantee is the rung claimed above.
            const id = await queueNotification(tx, {
              propertyId: row.propertyId,
              channel: channel!,
              template: COMPLIANCE_ALERT,
              locale: row.locale,
              recipient: phone,
              payload: { ...facts!, manual: row.state === 'manual' },
            })
            if (id) queued.push(id)
          }
        }

        await emit(tx, {
          propertyId: row.propertyId,
          entityType: 'compliance_obligation',
          entityId: row.id,
          eventType: 'compliance_obligation.alerted',
          origin: 'platform',
          actor: systemActor,
          payload: {
            adapterId: row.adapterId,
            state: row.state,
            fromRung: row.alertRung,
            toRung: due,
            handover,
            reaches,
            messages: queued.length,
            // A rung with no number on record, or no messaging channel on:
            // the inbox still has it, and the event says nobody was paged.
            unreachable,
            minutesToDeadline: Math.round((row.deadline.getTime() - now.getTime()) / 60_000),
          },
        })

        return queued
      }),
    )

    if (outcome === null) {
      result.raced += 1
      continue
    }
    result.alerted += 1
    for (const id of outcome) result.notificationIds.push({ id, propertyId: row.propertyId })
  }

  return result
}

type Tx = Parameters<Parameters<typeof asService>[0]>[0]

/**
 * What the message says: whose filing, by when, and the link. Resolved now
 * and stored with the message, like every notification's facts.
 */
async function alertFacts(
  tx: Tx,
  row: {
    authority: string
    reservationId: string | null
    periodDate: string | null
    deadline: Date
    slug: string
    timeZone: string
    locale: string
  },
  appUrl: string,
): Promise<ComplianceAlertFacts> {
  const base = `${appUrl.replace(/\/$/, '')}/${row.locale}/${row.slug}/console`

  let subject = row.periodDate ?? ''
  if (row.reservationId) {
    const [stay] = await tx
      .select({ reference: reservations.reference, guestName: guests.name })
      .from(reservations)
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(eq(reservations.id, row.reservationId))
      .limit(1)
    subject = stay?.guestName ?? stay?.reference ?? ''
  }

  return {
    authority: row.authority,
    subject,
    deadline: formatDeadline(row.deadline, row.locale, row.timeZone),
    url: row.reservationId ? `${base}/arrivals/${row.reservationId}` : `${base}/exceptions`,
    manual: false,
  }
}

/** The deadline as the property reads it: its own time zone and language. */
export function formatDeadline(deadline: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(deadline)
}
