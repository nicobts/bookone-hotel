import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { asService } from '../db/session'
import { adminAudit, entitlements, properties } from '../db/schema'
import type * as schema from '../db/schema'
import { emit } from '../events'
import type { Actor } from '../events/actor'
import {
  FEATURES,
  grantEntitlementIn,
  revokeEntitlementIn,
  type Feature,
} from '../onboarding/entitlements'

/**
 * Operator actions (ADR-031, Guest Desk WP0.8).
 *
 * Every mutation goes through `withAdminAudit`: the role is checked, the change
 * and its `admin_audit` row commit in one transaction — no change without a
 * record, no record without a change — and the reason the operator typed is
 * required. `admin_audit` itself cannot be updated or deleted (trigger).
 *
 * Staff identities come from the staff IdP (a separate Supabase project in
 * production) and never from the hotel-user store. This module does not
 * authenticate anyone: `apps/admin` verifies the staff session and hands over
 * a `StaffActor`; everything here trusts only that and the database.
 */
export type StaffRole = 'admin' | 'support'

export interface StaffActor {
  id: string
  email: string | null
  role: StaffRole
  /** The request's source address, when the caller has one. */
  ip?: string | null
}

type Tx = PostgresJsDatabase<typeof schema>

export class AdminRefused extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'AdminRefused'
  }
}

/** The actor string `domain_events` and `admin_audit` record for a staff member. */
export function staffActorId(staff: StaffActor): string {
  return `staff:${staff.id}`
}

/** For domain events: operators act as `system` with the operator named in the payload. */
const operatorActor: Actor = { kind: 'system' }

export async function withAdminAudit<T>(
  staff: StaffActor,
  entry: {
    action: string
    targetType: string
    targetId: string
    propertyId: string | null
    reason: string
  },
  change: (tx: Tx) => Promise<{ before: unknown; after: unknown; result: T }>,
): Promise<T> {
  // Support staff read; only admins change a property (ADR-031, read-only by default).
  if (staff.role !== 'admin') throw new AdminRefused('only an admin can change a property')

  const reason = entry.reason.trim()
  if (reason.length < 3) throw new AdminRefused('a reason is required')

  return asService((db) =>
    db.transaction(async (tx) => {
      const { before, after, result } = await change(tx)

      await tx.insert(adminAudit).values({
        actor: staffActorId(staff),
        actorEmail: staff.email,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        propertyId: entry.propertyId,
        reason,
        before: before ?? null,
        after: after ?? null,
        ip: staff.ip ?? null,
      })

      return result
    }),
  )
}

async function liveFeatures(tx: Tx, propertyId: string): Promise<string[]> {
  const rows = await tx
    .select({ feature: entitlements.feature })
    .from(entitlements)
    .where(and(eq(entitlements.propertyId, propertyId), isNull(entitlements.endedAt)))
  return rows.map((row) => row.feature).sort()
}

/** Grant or revoke one feature, audited. Idempotent in both directions. */
export async function adminSetFeature(
  staff: StaffActor,
  input: { propertyId: string; feature: Feature; enabled: boolean; reason: string },
): Promise<{ changed: boolean }> {
  if (!(FEATURES as readonly string[]).includes(input.feature))
    throw new AdminRefused('unknown feature')

  return withAdminAudit(
    staff,
    {
      action: input.enabled ? 'feature.grant' : 'feature.revoke',
      targetType: 'property',
      targetId: input.propertyId,
      propertyId: input.propertyId,
      reason: input.reason,
    },
    async (tx) => {
      const before = await liveFeatures(tx, input.propertyId)
      const changed = input.enabled
        ? (
            await grantEntitlementIn(tx, {
              propertyId: input.propertyId,
              feature: input.feature,
              note: `admin: ${input.reason.trim()}`,
              actor: operatorActor,
            })
          ).status === 'granted'
        : await revokeEntitlementIn(tx, {
            propertyId: input.propertyId,
            feature: input.feature,
            actor: operatorActor,
          })
      const after = await liveFeatures(tx, input.propertyId)
      return { before: { features: before }, after: { features: after }, result: { changed } }
    },
  )
}

/**
 * The kill switch (WP0.8): pause or resume the concierge at one property.
 *
 * Paused, the concierge still answers every guest — with the handover phrase,
 * "someone will reply here" — so nobody is left in silence, and nothing it
 * would have done is done. Takes effect on the next message: the reply path
 * reads it per turn, so there is no cache to wait out.
 */
export async function adminSetAgentPaused(
  staff: StaffActor,
  input: { propertyId: string; paused: boolean; reason: string },
): Promise<void> {
  await withAdminAudit(
    staff,
    {
      action: input.paused ? 'agent.pause' : 'agent.resume',
      targetType: 'property',
      targetId: input.propertyId,
      propertyId: input.propertyId,
      reason: input.reason,
    },
    async (tx) => {
      const [row] = await tx
        .select({ settings: properties.settings })
        .from(properties)
        .where(eq(properties.id, input.propertyId))
        .limit(1)
      if (!row) throw new AdminRefused('unknown property')

      const before = (row.settings as { agentPausedAt?: string } | null)?.agentPausedAt ?? null

      await tx
        .update(properties)
        .set({
          settings: input.paused
            ? sql`coalesce(${properties.settings}, '{}'::jsonb) || jsonb_build_object('agentPausedAt', now())`
            : sql`coalesce(${properties.settings}, '{}'::jsonb) - 'agentPausedAt'`,
        })
        .where(eq(properties.id, input.propertyId))

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'property',
        entityId: input.propertyId,
        eventType: input.paused ? 'agent.paused' : 'agent.resumed',
        origin: 'platform',
        actor: operatorActor,
        payload: { operator: staffActorId(staff) },
      })

      return {
        before: { agentPausedAt: before },
        after: { paused: input.paused },
        result: undefined,
      }
    },
  )
}

export interface AdminPropertyRow {
  id: string
  slug: string
  name: string
  createdAt: Date
  members: number
  features: string[]
  agentPaused: boolean
}

/** Every property, for the operator's list. Read-only; any staff role. */
export async function listPropertiesForAdmin(): Promise<AdminPropertyRow[]> {
  const rows = await asService((db) =>
    db
      .select({
        id: properties.id,
        slug: properties.slug,
        name: properties.name,
        createdAt: properties.createdAt,
        settings: properties.settings,
        // Correlated subqueries written with qualified names: Drizzle renders
        // columns unqualified inside `sql`, and an unqualified `id` binds to the
        // inner table — every property then shows zero members and no features.
        members: sql<number>`(select count(*)::int from property_members pm where pm.property_id = "properties"."id")`,
        features: sql<
          string[]
        >`coalesce((select array_agg(e.feature::text order by e.feature) from entitlements e where e.property_id = "properties"."id" and e.ended_at is null), '{}')`,
      })
      .from(properties)
      .orderBy(properties.name),
  )

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.createdAt,
    members: row.members,
    features: row.features,
    agentPaused: Boolean((row.settings as { agentPausedAt?: unknown } | null)?.agentPausedAt),
  }))
}

/** The operator trail, newest first — for one property or for everything. */
export async function listAdminAudit(
  propertyId: string | null,
  limit = 50,
): Promise<(typeof adminAudit.$inferSelect)[]> {
  return asService((db) =>
    db
      .select()
      .from(adminAudit)
      .where(propertyId ? eq(adminAudit.propertyId, propertyId) : undefined)
      .orderBy(desc(adminAudit.at))
      .limit(limit),
  )
}

export interface QueueHealth {
  name: string
  queued: number
  active: number
  failedLastDay: number
  lastCompletedAt: Date | null
}

/**
 * Queue health from pg-boss's own tables (WP0.8): depth, failures, and when
 * each job last finished. A job that should run every few minutes and last
 * finished yesterday is the thing an operator needs to see first.
 */
export async function queueHealth(): Promise<QueueHealth[]> {
  // pg-boss creates its schema when the worker first starts; before that there
  // is nothing to report, which is not an error.
  const [exists] = await asService((db) =>
    db.execute<{ present: boolean }>(sql`select to_regclass('pgboss.job') is not null as present`),
  )
  if (!exists?.present) return []

  const rows = await asService((db) =>
    db.execute<{
      name: string
      queued: number
      active: number
      failed: number
      last: Date | null
    }>(sql`
      select name,
             count(*) filter (where state in ('created', 'retry'))::int as queued,
             count(*) filter (where state = 'active')::int as active,
             count(*) filter (where state = 'failed' and created_on > now() - interval '1 day')::int as failed,
             max(completed_on) filter (where state = 'completed') as last
        from pgboss.job
       group by name
       order by name`),
  )

  return [...rows].map((row) => ({
    name: row.name,
    queued: row.queued,
    active: row.active,
    failedLastDay: row.failed,
    lastCompletedAt: row.last ? new Date(row.last) : null,
  }))
}
