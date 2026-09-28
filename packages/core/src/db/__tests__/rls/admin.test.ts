import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, db } from '../../client'
import { expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import {
  activeTenantView,
  AdminRefused,
  adminSetAgentPaused,
  listSupportAccess,
  startTenantView,
  tenantSnapshot,
  adminSetFeature,
  listAdminAudit,
  listPropertiesForAdmin,
  queueHealth,
  type StaffActor,
} from '../../../admin'
import { isEntitled } from '../../../onboarding/entitlements'
import { getReservationFacts } from '../../../concierge/facts'

/**
 * The operator console's core (ADR-031, Guest Desk WP0.8).
 *
 * Three claims, each of which fails silently if wrong: every change leaves
 * exactly one audit row with its reason; the audit trail cannot be edited or
 * removed, even by the service role; and no hotel user can read it.
 */

let fixture: Fixture

const admin: StaffActor = {
  id: 'op-admin',
  email: 'ops@bookone.test',
  role: 'admin',
  ip: '100.64.0.1',
}
const support: StaffActor = { id: 'op-support', email: 'support@bookone.test', role: 'support' }

async function auditCount(propertyId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from admin_audit where property_id = ${propertyId}`,
  )
  return row!.n
}

beforeAll(async () => {
  fixture = await seed()
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('audited changes', () => {
  it('refuses support staff and a missing reason, and writes nothing', async () => {
    const { propertyId } = fixture.alpha
    const before = await auditCount(propertyId)

    await expect(
      adminSetFeature(support, { propertyId, feature: 'rooms', enabled: true, reason: 'pilot' }),
    ).rejects.toBeInstanceOf(AdminRefused)
    await expect(
      adminSetFeature(admin, { propertyId, feature: 'rooms', enabled: true, reason: '  ' }),
    ).rejects.toBeInstanceOf(AdminRefused)

    expect(await auditCount(propertyId)).toBe(before)
    expect(await isEntitled(propertyId, 'rooms')).toBe(false)
  })

  it('grants and revokes a feature with exactly one audit row each', async () => {
    const { propertyId } = fixture.alpha
    const before = await auditCount(propertyId)

    expect(
      await adminSetFeature(admin, {
        propertyId,
        feature: 'rooms',
        enabled: true,
        reason: 'pilot agreed by phone',
      }),
    ).toEqual({ changed: true })
    expect(await isEntitled(propertyId, 'rooms')).toBe(true)

    await adminSetFeature(admin, {
      propertyId,
      feature: 'rooms',
      enabled: false,
      reason: 'pilot ended',
    })
    expect(await isEntitled(propertyId, 'rooms')).toBe(false)

    expect(await auditCount(propertyId)).toBe(before + 2)

    const [latest, previous] = await listAdminAudit(propertyId, 2)
    expect(latest).toMatchObject({
      actor: 'staff:op-admin',
      actorEmail: 'ops@bookone.test',
      action: 'feature.revoke',
      reason: 'pilot ended',
      ip: '100.64.0.1',
    })
    expect((latest!.before as { features: string[] }).features).toContain('rooms')
    expect((latest!.after as { features: string[] }).features).not.toContain('rooms')
    expect(previous!.action).toBe('feature.grant')

    // Nothing leaks onto the other property's trail.
    expect((await listAdminAudit(fixture.beta.propertyId)).length).toBe(0)
  })

  it('lists each property with its own members and live features', async () => {
    const { propertyId } = fixture.alpha
    const [expected] = await db.execute<{ members: number; features: string[] }>(
      sql`select (select count(*)::int from property_members where property_id = ${propertyId}) as members,
                 coalesce((select array_agg(feature::text order by feature) from entitlements
                            where property_id = ${propertyId} and ended_at is null), '{}') as features`,
    )
    const row = (await listPropertiesForAdmin()).find((p) => p.id === propertyId)
    expect(expected!.members).toBeGreaterThan(0)
    expect(row).toMatchObject({ members: expected!.members, features: expected!.features })
  })

  it('pauses and resumes the concierge, and the reply path sees it at once', async () => {
    const { propertyId, reservationId } = fixture.alpha

    await adminSetAgentPaused(admin, { propertyId, paused: true, reason: 'wrong answers reported' })
    expect((await getReservationFacts(propertyId, reservationId))?.agentPaused).toBe(true)
    expect((await listPropertiesForAdmin()).find((p) => p.id === propertyId)?.agentPaused).toBe(
      true,
    )

    await adminSetAgentPaused(admin, { propertyId, paused: false, reason: 'fixed' })
    expect((await getReservationFacts(propertyId, reservationId))?.agentPaused).toBe(false)

    const events = await db.execute<{ event_type: string }>(
      sql`select event_type from domain_events
           where property_id = ${propertyId} and event_type in ('agent.paused', 'agent.resumed')
           order by id`,
    )
    expect(events.map((e) => e.event_type)).toEqual(['agent.paused', 'agent.resumed'])
  })
})

describe('view-as-tenant', () => {
  it('lets support staff open a logged, time-boxed, read-only view', async () => {
    const { propertyId } = fixture.alpha
    const before = await auditCount(propertyId)

    expect(await activeTenantView(support, propertyId)).toBeNull()
    await expect(startTenantView(support, { propertyId, reason: '' })).rejects.toBeInstanceOf(
      AdminRefused,
    )

    const { expiresAt } = await startTenantView(support, {
      propertyId,
      reason: 'ticket 42: guest says no reply',
    })
    const minutes = (expiresAt.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(29)
    expect(minutes).toBeLessThanOrEqual(30)

    expect(await activeTenantView(support, propertyId)).not.toBeNull()
    // The window is per operator and per property.
    expect(await activeTenantView(admin, propertyId)).toBeNull()
    expect(await activeTenantView(support, fixture.beta.propertyId)).toBeNull()
    expect(await auditCount(propertyId)).toBe(before + 1)

    const snapshot = await tenantSnapshot(propertyId)
    expect(Array.isArray(snapshot.stays)).toBe(true)
    expect(Array.isArray(snapshot.threads)).toBe(true)
  })

  it('shows the property who looked and why, and only that property', async () => {
    const alpha = await listSupportAccess(fixture.alpha.user.id, fixture.alpha.propertyId)
    expect(alpha[0]).toMatchObject({
      operator: 'support@bookone.test',
      reason: 'ticket 42: guest says no reply',
    })

    // Alpha's owner asking about beta's property sees nothing: RLS decides.
    expect(await listSupportAccess(fixture.alpha.user.id, fixture.beta.propertyId)).toEqual([])
  })

  it('ends the window after 30 minutes', async () => {
    const { propertyId } = fixture.beta
    await startTenantView(support, { propertyId, reason: 'expiry check' })
    expect(await activeTenantView(support, propertyId)).not.toBeNull()
    // The trail is append-only, so the clock is moved by looking from later
    // rather than by editing the row.
    const later = new Date(Date.now() + 31 * 60_000)
    expect(await activeTenantView(support, propertyId, later)).toBeNull()
  })
})

describe('the audit trail is append-only', () => {
  it('refuses UPDATE, DELETE and TRUNCATE, even on the service connection', async () => {
    const { propertyId } = fixture.alpha
    const count = await auditCount(propertyId)
    expect(count).toBeGreaterThan(0)

    await expectPolicyRefusal(() =>
      db.execute(
        sql`update admin_audit set reason = 'rewritten' where property_id = ${propertyId}`,
      ),
    )
    await expectPolicyRefusal(() =>
      db.execute(sql`delete from admin_audit where property_id = ${propertyId}`),
    )
    await expectPolicyRefusal(() => db.execute(sql`truncate table admin_audit`))

    expect(await auditCount(propertyId)).toBe(count)
  })
})

describe('no hotel user can read it', () => {
  it('refuses an owner outright, even for their own property', async () => {
    // Not an empty list: no client role holds any privilege on the table, so
    // the refusal comes before RLS is even consulted.
    await expect(selectAs(fixture.alpha.user, 'admin_audit')).rejects.toThrow(
      /permission denied for table admin_audit/,
    )
  })
})

describe('queue health', () => {
  it('reports without failing, with or without pg-boss installed', async () => {
    const health = await queueHealth()
    expect(Array.isArray(health)).toBe(true)
  })
})
