import { and, asc, desc, eq, gte, lt, lte } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { asService } from '../db/session'
import { attributionEvents, feeEvents, reservations } from '../db/schema'
import type * as schema from '../db/schema'

/**
 * Who earned the booking (D14, PRD §6).
 *
 * The published rule, in full: *a booking is AI-attributed only if it
 * originates in a concierge call or chat session (session id present at
 * reservation creation) **and** no engine session preceded it within 24h.
 * Disputes resolve in the owner's favour.*
 *
 * ## What this replaces
 *
 * Sprint 4 could not implement the window. The reservation carried session
 * *ids* but nothing carried *when*, so `classifyBooking` used a stricter proxy —
 * the presence of an engine session id at all — and said so in a comment.
 *
 * The direction of that compromise was deliberate and is worth restating,
 * because it constrains what this file is allowed to do. The proxy
 * **under**-attributes: a guest who browsed the engine three weeks ago and then
 * booked through chat was billed at the direct rate, which is cheaper. Moving to
 * the real window can only move fees *up*.
 *
 * That is a conversation with an owner rather than a refund to one, which is
 * the only direction it was safe to be wrong in — and it is why this file
 * cannot be switched on retroactively over fees already billed. `reclassify`
 * exists and reports; it does not rewrite history.
 */

type Tx = PostgresJsDatabase<typeof schema>

export type AttributionChannel = 'engine' | 'concierge_chat' | 'concierge_voice'

/**
 * How far back an engine session disqualifies a concierge booking.
 *
 * 24 hours, from D14. Not a tunable: it is a contract term, and a property
 * billed under a window we quietly widened would be billed under a rule they
 * never agreed to. Changing it is a contract amendment and an ADR.
 */
export const ATTRIBUTION_WINDOW_HOURS = 24

export interface TouchInput {
  propertyId: string
  sessionId: string
  channel: AttributionChannel
  /** When the touch happened. Never defaulted — see the column comment. */
  occurredAt: Date
  reservationId?: string
}

/** Record one session touching this property. In the caller's transaction. */
export async function recordTouchIn(tx: Tx, input: TouchInput): Promise<void> {
  await tx.insert(attributionEvents).values({
    propertyId: input.propertyId,
    sessionId: input.sessionId,
    channel: input.channel,
    occurredAt: input.occurredAt,
    reservationId: input.reservationId ?? null,
  })
}

/** The same, on its own connection. */
export async function recordTouch(input: TouchInput): Promise<void> {
  await asService((db) => db.transaction((tx) => recordTouchIn(tx, input)))
}

export type AttributionKind = 'direct_booking' | 'ai_attributed'

export interface AttributionVerdict {
  kind: AttributionKind
  /** Everything a dispute would need, stored with the fee rather than re-derived. */
  evidence: Record<string, unknown>
}

export interface WindowTouch {
  sessionId: string
  channel: AttributionChannel
  occurredAt: Date
}

/**
 * Decide, from the touches in the window. Pure, so the rule is tested directly.
 *
 * Reads as a series of refusals, and that is the shape D14 asks for: every
 * ambiguous case falls through to `direct_booking`, which is the cheaper fee.
 */
export function decideAttribution(input: {
  bookedAt: Date
  /** Every touch this property saw in the window ending at `bookedAt`. */
  touches: WindowTouch[]
  /** The session recorded on the reservation itself, when there was one. */
  conciergeSessionId: string | null
  /**
   * The engine session on the same reservation, when there is one.
   *
   * A booking carrying both is one where the guest was already in the booking
   * engine — the plainest possible case of the conversation not having produced
   * it. Considered alongside the concierge session so a *separate* browser
   * session recorded on the reservation still disqualifies.
   */
  engineSessionId?: string | null
  windowHours?: number
}): AttributionVerdict {
  const windowHours = input.windowHours ?? ATTRIBUTION_WINDOW_HOURS
  const windowStart = new Date(input.bookedAt.getTime() - windowHours * 3_600_000)

  const base = {
    rule: 'd14-v1',
    windowHours,
    windowStart: windowStart.toISOString(),
    bookedAt: input.bookedAt.toISOString(),
  }

  if (!input.conciergeSessionId) {
    return {
      kind: 'direct_booking',
      evidence: { ...base, reason: 'no concierge session on the reservation' },
    }
  }

  const inWindow = input.touches.filter(
    (touch) => touch.occurredAt >= windowStart && touch.occurredAt <= input.bookedAt,
  )

  /*
   * "Preceded" means before the *concierge session's own first touch*, not
   * merely before the booking.
   *
   * The difference is a real case and it decides money. A guest opens the
   * booking engine, gets stuck, and opens the chat from the same page — the
   * engine touch is earlier than the booking but *later* than nothing, and the
   * concierge is plainly what produced the reservation. Comparing against the
   * booking timestamp would call every such stay direct.
   *
   * Comparing against the concierge session's start is what the rule means by
   * "originates in", and it is still conservative: an engine session genuinely
   * earlier than the conversation disqualifies it.
   */
  /*
   * The conversation's own touches: same session **and** a concierge channel.
   *
   * The channel check is not redundant, and leaving it out was a real bug the
   * tests caught. A guest who opens the booking engine and then the chat from
   * that page keeps the same browser session id, so filtering on the session
   * alone swept the engine touch in — and `conciergeStart` became the moment
   * they opened the *engine*. Nothing could then precede it, and the case D14
   * exists to exclude was billed at the higher rate.
   */
  const conciergeTouches = inWindow.filter(
    (touch) =>
      touch.sessionId === input.conciergeSessionId &&
      (touch.channel === 'concierge_chat' || touch.channel === 'concierge_voice'),
  )

  if (conciergeTouches.length === 0) {
    // The reservation names a concierge session we have no record of. Not an
    // error — the touch may predate this table, or a write may have been lost —
    // and emphatically not something to bill the higher rate on.
    return {
      kind: 'direct_booking',
      evidence: {
        ...base,
        reason: 'concierge session named on the reservation has no touch in the window',
        conciergeSessionId: input.conciergeSessionId,
      },
    }
  }

  const conciergeStart = conciergeTouches.reduce(
    (earliest, touch) => (touch.occurredAt < earliest ? touch.occurredAt : earliest),
    conciergeTouches[0]!.occurredAt,
  )

  /*
   * Only engine touches belonging to **this booking** disqualify it.
   *
   * The rule says "no engine session preceded *it*", and `it` is the booking.
   * The first implementation compared against every engine touch the property
   * saw in the window, and the database test caught it immediately: one guest
   * browsing the booking engine disqualified an unrelated conversation an hour
   * later. At a property taking a few bookings a day, nothing would ever be
   * attributed — which is cheap for the owner and makes the entire AI-attributed
   * line meaningless.
   *
   * A booking's own sessions are the concierge session that produced it and any
   * engine session recorded on the reservation. In practice they are frequently
   * the same string: a guest opens the booking engine, gets stuck, and opens the
   * chat from that page in the same browser session. That is exactly the case
   * D14 means to exclude, and it is the one this catches.
   *
   * A guest who browses in one browser and chats in another escapes the
   * disqualification. That is the residual error and it runs in our favour, so
   * it is the part to watch: AG-07 re-checks these nightly, and a dispute
   * resolves the owner's way regardless.
   */
  const bookingSessions = new Set(
    [input.conciergeSessionId, input.engineSessionId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  )

  const precedingEngine = inWindow
    .filter(
      (touch) =>
        touch.channel === 'engine' &&
        bookingSessions.has(touch.sessionId) &&
        touch.occurredAt < conciergeStart,
    )
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  if (precedingEngine.length > 0) {
    return {
      kind: 'direct_booking',
      evidence: {
        ...base,
        reason: 'an engine session preceded the concierge session inside the window',
        conciergeSessionId: input.conciergeSessionId,
        conciergeStartedAt: conciergeStart.toISOString(),
        precededBy: precedingEngine.map((touch) => ({
          sessionId: touch.sessionId,
          occurredAt: touch.occurredAt.toISOString(),
        })),
      },
    }
  }

  return {
    kind: 'ai_attributed',
    evidence: {
      ...base,
      reason: 'concierge session with no engine session before it in the window',
      conciergeSessionId: input.conciergeSessionId,
      conciergeStartedAt: conciergeStart.toISOString(),
      channel: conciergeTouches[0]!.channel,
      /*
       * The count of engine touches *anywhere* in the window, including after
       * the conversation started.
       *
       * Not used by the rule. Stored because it is the first thing anybody
       * disputing this line will ask about, and an evidence chain that omits
       * the inconvenient number is one nobody will believe the rest of.
       */
      /*
       * Engine touches by *this booking's own sessions*, after the conversation
       * started.
       *
       * Not used by the rule. Stored because it is the first thing anybody
       * disputing this line will ask about, and an evidence chain that omits
       * the inconvenient number is one nobody will believe the rest of.
       */
      engineTouchesInWindow: inWindow.filter(
        (touch) => touch.channel === 'engine' && bookingSessions.has(touch.sessionId),
      ).length,
    },
  }
}

/** Load the window and decide, in one call. What the confirmation path uses. */
export async function attributeBookingIn(
  tx: Tx,
  input: {
    propertyId: string
    bookedAt: Date
    conciergeSessionId: string | null
    engineSessionId?: string | null
    windowHours?: number
  },
): Promise<AttributionVerdict> {
  // No concierge session means the answer is `direct_booking` whatever the
  // window holds, so the query is skipped rather than run and ignored — this is
  // the overwhelmingly common case on every booking the engine produces.
  if (!input.conciergeSessionId) {
    return decideAttribution({ ...input, touches: [] })
  }

  const windowHours = input.windowHours ?? ATTRIBUTION_WINDOW_HOURS
  const windowStart = new Date(input.bookedAt.getTime() - windowHours * 3_600_000)

  const touches = await tx
    .select({
      sessionId: attributionEvents.sessionId,
      channel: attributionEvents.channel,
      occurredAt: attributionEvents.occurredAt,
    })
    .from(attributionEvents)
    .where(
      and(
        eq(attributionEvents.propertyId, input.propertyId),
        gte(attributionEvents.occurredAt, windowStart),
        lte(attributionEvents.occurredAt, input.bookedAt),
      ),
    )
    .orderBy(asc(attributionEvents.occurredAt))

  return decideAttribution({ ...input, touches })
}

/**
 * What the rule *would* say about a booking already billed.
 *
 * Reports; never rewrites. A fee is computed once, at confirmation, from the
 * values true at that moment — and the monthly report built on those rows is
 * the invoice. Re-deriving a billed fee against a database that has moved on is
 * how an invoice changes between two readings, which is the failure the frozen
 * report exists to prevent.
 *
 * Its real use is AG-07 and the migration off the Sprint 4 proxy: a list of
 * bookings whose stored classification disagrees with the current rule is a
 * conversation to have with an owner, deliberately, in daylight.
 */
export async function reclassify(input: { propertyId: string; from: Date; to: Date }): Promise<
  {
    reservationId: string
    storedKind: string
    wouldBe: AttributionKind
    evidence: Record<string, unknown>
  }[]
> {
  return asService(async (db) => {
    const rows = await db
      .select({
        reservationId: feeEvents.reservationId,
        storedKind: feeEvents.kind,
        createdAt: feeEvents.createdAt,
        conciergeSessionId: reservations.conciergeSessionId,
        engineSessionId: reservations.engineSessionId,
      })
      .from(feeEvents)
      .innerJoin(reservations, eq(reservations.id, feeEvents.reservationId))
      .where(
        and(
          eq(feeEvents.propertyId, input.propertyId),
          gte(feeEvents.createdAt, input.from),
          lt(feeEvents.createdAt, input.to),
        ),
      )
      .orderBy(desc(feeEvents.createdAt))

    const out = []

    for (const row of rows) {
      const verdict = await attributeBookingIn(db, {
        propertyId: input.propertyId,
        bookedAt: row.createdAt,
        conciergeSessionId: row.conciergeSessionId,
        engineSessionId: row.engineSessionId,
      })

      out.push({
        reservationId: row.reservationId,
        storedKind: row.storedKind,
        wouldBe: verdict.kind,
        evidence: verdict.evidence,
      })
    }

    return out
  })
}
