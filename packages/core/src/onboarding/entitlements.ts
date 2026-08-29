import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { entitlements } from '../db/schema'
import { emit } from '../events'
import { systemActor, type Actor } from '../events/actor'

/**
 * What a property has bought (E7.3, D14 row 4).
 *
 * ## Absence is the answer, and the answer is no
 *
 * There is no row meaning "not entitled". A feature is on when a live row says
 * so. That makes every failure in this plumbing fail *closed*: a property loses
 * a module they paid for and tells us within the hour, rather than silently
 * gaining one they did not, which nobody ever reports.
 *
 * The inverse — a default-on list with rows meaning "revoked" — fails the other
 * way, and the other way is the one that ends up in an audit.
 */

/**
 * The features the product knows how to sell.
 *
 * A closed list here and free text in the column, deliberately: the column has
 * to accept a module sold before the code names it, and this list is what the
 * code will actually branch on. A row for something absent from this list is
 * data, not a capability.
 */
export const FEATURES = ['concierge', 'rooms', 'reporting'] as const

export type Feature = (typeof FEATURES)[number]

/** Live features for a property. */
export async function listEntitlements(propertyId: string): Promise<string[]> {
  const rows = await asService((db) =>
    db
      .select({ feature: entitlements.feature })
      .from(entitlements)
      .where(and(eq(entitlements.propertyId, propertyId), isNull(entitlements.endedAt)))
      .orderBy(asc(entitlements.feature)),
  )

  return rows.map((row) => row.feature)
}

/** Whether one feature is live. */
export async function isEntitled(propertyId: string, feature: string): Promise<boolean> {
  return (await listEntitlements(propertyId)).includes(feature)
}

/**
 * Grant a feature.
 *
 * Idempotent: granting a live feature returns the existing row rather than
 * creating a second, because the partial unique index would refuse it anyway
 * and a caller re-running a provisioning script should not have to care.
 */
export async function grantEntitlement(input: {
  propertyId: string
  feature: string
  note?: string
  actor?: Actor
}): Promise<{ status: 'granted' | 'already-granted'; id: string }> {
  return asService((db) =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: entitlements.id })
        .from(entitlements)
        .where(
          and(
            eq(entitlements.propertyId, input.propertyId),
            eq(entitlements.feature, input.feature),
            isNull(entitlements.endedAt),
          ),
        )
        .limit(1)

      if (existing) return { status: 'already-granted' as const, id: existing.id }

      const [row] = await tx
        .insert(entitlements)
        .values({
          propertyId: input.propertyId,
          feature: input.feature,
          note: input.note ?? null,
        })
        .returning({ id: entitlements.id })

      if (!row) throw new Error('entitlements insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'entitlement',
        entityId: row.id,
        eventType: 'entitlement.granted',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: { feature: input.feature },
      })

      return { status: 'granted' as const, id: row.id }
    }),
  )
}

/**
 * Revoke a feature.
 *
 * Ends the row; never deletes it. "Never had it" and "had it until March" are
 * different answers to the same question, and a billing dispute is exactly
 * where the difference is asked about.
 */
export async function revokeEntitlement(input: {
  propertyId: string
  feature: string
  actor?: Actor
}): Promise<boolean> {
  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(entitlements)
        /*
         * `now()`, not a `Date` from this process.
         *
         * `granted_at` is stamped by the database and the check constraint
         * compares the two. This machine's clock is ~600ms behind the database
         * container's, so an app-generated `ended_at` can land *before* a
         * `granted_at` written moments earlier — and the revoke fails the
         * constraint, intermittently, depending on how much wall-clock time
         * happened to pass in between.
         *
         * Caught by this suite failing in a full run and passing on its own.
         * The rule it teaches: two timestamps compared by a constraint must
         * come from one clock, and the database already has one.
         */
        .set({ endedAt: sql`now()` })
        .where(
          and(
            eq(entitlements.propertyId, input.propertyId),
            eq(entitlements.feature, input.feature),
            isNull(entitlements.endedAt),
          ),
        )
        .returning({ id: entitlements.id })

      if (!row) return false

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'entitlement',
        entityId: row.id,
        eventType: 'entitlement.revoked',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: { feature: input.feature },
      })

      return true
    }),
  )
}
