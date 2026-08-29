import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm'
import { asService } from '../db/session'
import { feeDisputes, feeEvents, monthlyReports, subscriptions } from '../db/schema'
import { emit } from '../events'
import { userActor } from '../events/actor'

/**
 * Disagreeing with a fee (E5.4, D14).
 *
 * D14 says disputes resolve in the owner's favour. This implements that
 * literally: raising a dispute credits the fee, immediately, and the
 * conversation happens afterwards.
 *
 * ## Why there is no adjudication step
 *
 * Because a policy with one behaves differently under load than it reads in a
 * contract. The first time an owner raised a dispute and lost it, they would
 * stop believing the rest of the statement — and the statement's only job is to
 * be believed (PRD C4, M6).
 *
 * The cost of being wrong is one fee. The cost of the alternative is the owner
 * concluding that the numbers are a negotiation, which is the trust
 * architecture failing at the exact point it was supposed to pay off.
 *
 * A rising dispute rate means the attribution rule is wrong. It is a signal to
 * read, not a queue to work.
 */

export type RaiseOutcome =
  | { status: 'credited'; disputeId: string; creditCents: number }
  /** Already disputed. Idempotent — a double-tap is one disagreement. */
  | { status: 'already-disputed'; disputeId: string }
  | { status: 'rejected'; reason: string }

export async function raiseDispute(input: {
  propertyId: string
  feeEventId: string
  userId: string
  reason?: string
}): Promise<RaiseOutcome> {
  return asService((db) =>
    db.transaction(async (tx) => {
      const [fee] = await tx
        .select({
          id: feeEvents.id,
          reservationId: feeEvents.reservationId,
          kind: feeEvents.kind,
          feeCents: feeEvents.feeCents,
          createdAt: feeEvents.createdAt,
        })
        .from(feeEvents)
        .where(and(eq(feeEvents.id, input.feeEventId), eq(feeEvents.propertyId, input.propertyId)))
        .limit(1)

      if (!fee) return { status: 'rejected' as const, reason: 'no such fee for this property' }

      const [existing] = await tx
        .select({ id: feeDisputes.id })
        .from(feeDisputes)
        .where(eq(feeDisputes.feeEventId, fee.id))
        .limit(1)

      if (existing) {
        return { status: 'already-disputed' as const, disputeId: existing.id }
      }

      /*
       * A fee inside an already-issued report may still be disputed.
       *
       * The credit lands on the *next* statement rather than reopening the
       * issued one — that is what "frozen" means, and reopening it would break
       * the guarantee the whole report rests on. The owner is not blocked from
       * disagreeing with something we already billed; they simply cannot make
       * last month's document say something different from the copy they hold.
       */
      const now = new Date()

      const [row] = await tx
        .insert(feeDisputes)
        .values({
          propertyId: input.propertyId,
          feeEventId: fee.id,
          raisedBy: input.userId,
          reason: input.reason?.trim().slice(0, 1000) ?? null,
          // Credited on arrival. There is no state in which a dispute exists
          // and the money has not come off.
          status: 'credited',
          creditCents: fee.feeCents,
          creditedAt: now,
        })
        .returning({ id: feeDisputes.id })

      if (!row) throw new Error('fee_disputes insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'fee_dispute',
        entityId: row.id,
        eventType: 'fee.disputed',
        origin: 'platform',
        actor: userActor(input.userId),
        payload: {
          feeEventId: fee.id,
          reservationId: fee.reservationId,
          kind: fee.kind,
          creditCents: fee.feeCents,
        },
      })

      return { status: 'credited' as const, disputeId: row.id, creditCents: fee.feeCents }
    }),
  )
}

/**
 * The dispute rate for a property, over a window.
 *
 * Reported rather than alerted on, and read as a signal about the *rule* rather
 * than about the owner: if a tenth of attributed bookings are being disputed,
 * the attribution is wrong and the fix is in `attribution.ts`.
 */
export async function disputeRate(input: {
  propertyId: string
  from: Date
  to: Date
}): Promise<{ fees: number; disputed: number }> {
  return asService(async (db) => {
    const rows = await db
      .select({ id: feeEvents.id, disputeId: feeDisputes.id })
      .from(feeEvents)
      .leftJoin(feeDisputes, eq(feeDisputes.feeEventId, feeEvents.id))
      .where(
        and(
          eq(feeEvents.propertyId, input.propertyId),
          eq(feeEvents.kind, 'ai_attributed'),
          gte(feeEvents.createdAt, input.from),
          lt(feeEvents.createdAt, input.to),
        ),
      )

    return {
      fees: rows.length,
      disputed: rows.filter((row) => row.disputeId !== null).length,
    }
  })
}

// ---------------------------------------------------------------------------
// Subscriptions (D14 row 1)
// ---------------------------------------------------------------------------

/**
 * Record a property's plan.
 *
 * Ends the current subscription rather than editing it, because the report for
 * March has to be able to say what March cost after the price changes in June.
 * A table where the past can be edited is a table that cannot support a
 * statement.
 */
export async function setSubscription(input: {
  propertyId: string
  plan: string
  baseCents: number
  currency?: string
  rooms?: number
  startedAt?: Date
}): Promise<string> {
  const startedAt = input.startedAt ?? new Date()

  return asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({ endedAt: startedAt })
        .where(
          and(
            eq(subscriptions.propertyId, input.propertyId),
            // Only the live one. A historic row already has an end date, and
            // stamping it again would rewrite what a past report was built on.
            isNull(subscriptions.endedAt),
          ),
        )

      const [row] = await tx
        .insert(subscriptions)
        .values({
          propertyId: input.propertyId,
          plan: input.plan,
          baseCents: input.baseCents,
          currency: input.currency ?? 'EUR',
          rooms: input.rooms ?? null,
          startedAt,
        })
        .returning({ id: subscriptions.id })

      if (!row) throw new Error('subscriptions insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'subscription',
        entityId: row.id,
        eventType: 'subscription.recorded',
        origin: 'platform',
        actor: { kind: 'system' },
        payload: { plan: input.plan, baseCents: input.baseCents, rooms: input.rooms ?? null },
      })

      return row.id
    }),
  )
}

/** The plan live at a moment, or null. */
export async function subscriptionAt(
  propertyId: string,
  at: Date,
): Promise<{ plan: string; baseCents: number; currency: string; rooms: number | null } | null> {
  const [row] = await asService((db) =>
    db
      .select({
        plan: subscriptions.plan,
        baseCents: subscriptions.baseCents,
        currency: subscriptions.currency,
        rooms: subscriptions.rooms,
        startedAt: subscriptions.startedAt,
        endedAt: subscriptions.endedAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.propertyId, propertyId))
      .orderBy(asc(subscriptions.startedAt)),
  ).then((rows) =>
    rows.filter((row) => row.startedAt <= at && (row.endedAt === null || row.endedAt > at)),
  )

  return row
    ? { plan: row.plan, baseCents: row.baseCents, currency: row.currency, rooms: row.rooms }
    : null
}

/** Whether a period has been issued. The console shows drafts differently. */
export async function reportStatusFor(
  propertyId: string,
  periodStart: string,
): Promise<'draft' | 'issued' | 'none'> {
  const [row] = await asService((db) =>
    db
      .select({ status: monthlyReports.status })
      .from(monthlyReports)
      .where(
        and(eq(monthlyReports.propertyId, propertyId), eq(monthlyReports.periodStart, periodStart)),
      )
      .limit(1),
  )

  return row?.status ?? 'none'
}
