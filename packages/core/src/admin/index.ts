import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { asService, withUser } from '../db/session'
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
  options: { allowSupport?: boolean } = {},
): Promise<T> {
  // Support staff read; only admins change a property (ADR-031, read-only by
  // default). An audited *read* — view-as-tenant — is open to both.
  if (staff.role !== 'admin' && !(options.allowSupport && staff.role === 'support')) {
    throw new AdminRefused('only an admin can change a property')
  }

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

/**
 * View-as-tenant (ADR-031): read-only, 30 minutes, a reason, logged, and
 * visible to the property.
 *
 * The grant *is* the audit row. Starting a view writes `tenant.view` with the
 * reason, and the window is "a `tenant.view` row by this operator for this
 * property in the last 30 minutes" — no cookie to forge, no token to leak, and
 * nothing to revoke that the trail does not already show. The property sees
 * the same event in its own console (`support_access.started`).
 *
 * Read-only by construction: the snapshot below is the only thing a view can
 * reach, and it is select statements under the service role. There is no
 * impersonation — the operator never holds a hotel user's session.
 */
export const TENANT_VIEW_MINUTES = 30

export async function startTenantView(
  staff: StaffActor,
  input: { propertyId: string; reason: string },
): Promise<{ expiresAt: Date }> {
  return withAdminAudit(
    staff,
    {
      action: 'tenant.view',
      targetType: 'property',
      targetId: input.propertyId,
      propertyId: input.propertyId,
      reason: input.reason,
    },
    async (tx) => {
      const [row] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, input.propertyId))
        .limit(1)
      if (!row) throw new AdminRefused('unknown property')

      const expiresAt = new Date(Date.now() + TENANT_VIEW_MINUTES * 60_000)

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'property',
        entityId: input.propertyId,
        eventType: 'support_access.started',
        origin: 'platform',
        actor: operatorActor,
        payload: {
          operator: staff.email ?? staffActorId(staff),
          reason: input.reason.trim(),
          expiresAt: expiresAt.toISOString(),
          readOnly: true,
        },
      })

      return { before: null, after: { expiresAt: expiresAt.toISOString() }, result: { expiresAt } }
    },
    { allowSupport: true },
  )
}

/** When this operator's view of this property ends, or null when there is none. */
export async function activeTenantView(
  staff: StaffActor,
  propertyId: string,
  /**
   * Injectable so the expiry is testable against an append-only trail. Only the
   * lower bound uses it: an upper bound would compare the database's clock with
   * this process's, and a fraction of a second of drift would close a window
   * that was opened a moment ago.
   */
  now: Date = new Date(),
): Promise<Date | null> {
  const [row] = await asService((db) =>
    db
      .select({ at: adminAudit.at })
      .from(adminAudit)
      .where(
        and(
          eq(adminAudit.actor, staffActorId(staff)),
          eq(adminAudit.propertyId, propertyId),
          eq(adminAudit.action, 'tenant.view'),
          sql`${adminAudit.at} > ${now.toISOString()}::timestamptz - make_interval(mins => ${TENANT_VIEW_MINUTES})`,
        ),
      )
      .orderBy(desc(adminAudit.at))
      .limit(1),
  )
  return row ? new Date(row.at.getTime() + TENANT_VIEW_MINUTES * 60_000) : null
}

export interface TenantSnapshot {
  stays: {
    reference: string | null
    arrivalDate: string
    departureDate: string
    status: string
    guestName: string | null
  }[]
  threads: {
    id: string
    status: string
    messages: number
    lastGuestMessageAt: Date | null
    escalationReason: string | null
  }[]
  runs: { agent: string; outcome: string | null; model: string | null; at: Date }[]
}

/**
 * What an operator sees during a view: the next fortnight's stays, the
 * conversations' state, and the assistant's recent runs. Message bodies and
 * documents are deliberately absent — "why did the concierge escalate" is
 * answerable from status and reason, and anything more is a request to the
 * property, not a support view.
 */
export async function tenantSnapshot(propertyId: string): Promise<TenantSnapshot> {
  return asService(async (db) => {
    const stays = await db.execute<{
      reference: string | null
      arrival_date: string
      departure_date: string
      status: string
      guest_name: string | null
    }>(sql`
      select r.reference, r.arrival_date::text, r.departure_date::text, r.status::text, g.name as guest_name
        from reservations r left join guests g on g.id = r.guest_id
       where r.property_id = ${propertyId}
         and r.departure_date >= current_date
         and r.arrival_date <= current_date + 14
       order by r.arrival_date
       limit 50`)

    const threads = await db.execute<{
      id: string
      status: string
      messages: number
      last_guest_message_at: Date | null
      escalation_reason: string | null
    }>(sql`
      select t.id, t.status::text, t.last_guest_message_at, t.escalation_reason,
             (select count(*)::int from messages m where m.thread_id = t.id) as messages
        from message_threads t
       where t.property_id = ${propertyId}
       order by t.updated_at desc
       limit 30`)

    const runs = await db.execute<{
      agent: string
      outcome: string | null
      model: string | null
      at: Date
    }>(sql`
      select agent, outcome::text, model, at
        from agent_runs
       where property_id = ${propertyId}
       order by at desc
       limit 30`)

    return {
      stays: [...stays].map((s) => ({
        reference: s.reference,
        arrivalDate: s.arrival_date,
        departureDate: s.departure_date,
        status: s.status,
        guestName: s.guest_name,
      })),
      threads: [...threads].map((t) => ({
        id: t.id,
        status: t.status,
        messages: t.messages,
        lastGuestMessageAt: t.last_guest_message_at ? new Date(t.last_guest_message_at) : null,
        escalationReason: t.escalation_reason,
      })),
      runs: [...runs].map((r) => ({
        agent: r.agent,
        outcome: r.outcome,
        model: r.model,
        at: new Date(r.at),
      })),
    }
  })
}

export interface SupportAccess {
  at: Date
  operator: string
  reason: string
  expiresAt: string | null
}

/**
 * The property's side of the transparency (ADR-031): every support view of
 * this property, read as the signed-in hotel user — so RLS on `domain_events`
 * decides what they may see, exactly as for any other event of theirs.
 */
export async function listSupportAccess(
  userId: string,
  propertyId: string,
): Promise<SupportAccess[]> {
  const rows = await withUser(userId, (tx) =>
    tx.execute<{ at: Date; payload: Record<string, unknown> }>(sql`
      select at, payload from domain_events
       where property_id = ${propertyId} and event_type = 'support_access.started'
       order by id desc
       limit 50`),
  )
  return [...rows].map((row) => ({
    at: new Date(row.at),
    operator: String(row.payload.operator ?? 'BookOne'),
    reason: String(row.payload.reason ?? ''),
    expiresAt: typeof row.payload.expiresAt === 'string' ? row.payload.expiresAt : null,
  }))
}
