import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, selectAs, type Fixture } from './support'
import { grantEntitlement, revokeEntitlement } from '../../../onboarding/entitlements'
import { alloggiatiCapabilities } from '../../../compliance/alloggiati'
import { alertDueObligations } from '../../../compliance/alerts'
import type { ComplianceAdapter } from '../../../compliance/adapter'
import type { ObligationState } from '../../../compliance/lifecycle'
import { listObligationsForOwner } from '../../../compliance/obligations'
import { listExceptions } from '../../queries/exceptions'
import { COMPLIANCE_ALERT } from '../../../notifications'

/**
 * The alert ladder against a real database (WP1.5).
 *
 * What only a database can show: the rung is claimed by a conditional update,
 * so two sweeps at once send one set of messages; the messages land in the
 * outbox addressed to the numbers on record; the inbox shows the obligation to
 * its own property's members and to nobody else.
 *
 * Nothing is sent: the outbox is written, and no provider runs here.
 */

let fixture: Fixture

const STAFF = '+390400000101'
const OWNER = '+390400000201'

/** Only capabilities are read by the ladder: which feature gates the adapter. */
const alloggiati = {
  capabilities: () => alloggiatiCapabilities(true),
} as unknown as ComplianceAdapter
const deps = { adapters: new Map([['alloggiati', alloggiati]]) }

const APP_URL = 'https://app.example.test'
const HOUR = 3_600_000

beforeAll(async () => {
  fixture = await seed()
  for (const property of [fixture.alpha, fixture.beta]) {
    await grantEntitlement({ propertyId: property.propertyId, feature: 'alloggiati' })
    await db.execute(sql`
      update properties
         set settings = settings || ${JSON.stringify({ staffPhones: [STAFF], ownerPhones: [OWNER] })}::jsonb,
             timezone = 'Europe/Rome'
       where id = ${property.propertyId}`)
  }
  // Alpha can message; beta has no messaging channel on.
  await grantEntitlement({ propertyId: fixture.alpha.propertyId, feature: 'whatsapp' })
})

afterAll(async () => {
  await closeConnection()
})

let serial = 0

async function obligation(
  propertyId: string,
  reservationId: string | null,
  deadline: Date,
  state: ObligationState = 'pending',
): Promise<string> {
  serial += 1
  const [row] = await db.execute<{ id: string }>(sql`
    insert into compliance_obligations
      (property_id, adapter_id, authority, type, subject_key, reservation_id, deadline, state)
    values (${propertyId}, 'alloggiati', 'questura', 'guest_registration',
            ${`reservation:${reservationId ?? 'none'}-${serial}`}, ${reservationId},
            ${deadline.toISOString()}, ${state})
    returning id`)
  return row!.id
}

async function rungOf(id: string): Promise<number> {
  const [row] = await db.execute<{ alert_rung: number }>(
    sql`select alert_rung from compliance_obligations where id = ${id}`,
  )
  return row!.alert_rung
}

async function messages(propertyId: string): Promise<{ recipient: string; payload: unknown }[]> {
  return db.execute<{ recipient: string; payload: unknown }>(sql`
    select recipient, payload from notifications
     where property_id = ${propertyId} and template = ${COMPLIANCE_ALERT}
     order by created_at`)
}

async function clearAlerts(): Promise<void> {
  await db.execute(sql`delete from notifications where template = ${COMPLIANCE_ALERT}`)
  await db.execute(sql`delete from compliance_obligations`)
}

describe('the alert ladder (WP1.5)', () => {
  it('climbs to the staff rung five hours out and messages the staff number once', async () => {
    await clearAlerts()
    const now = new Date()
    const id = await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + 5 * HOUR),
    )

    const first = await alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now })
    expect(first.alerted).toBe(1)
    expect(await rungOf(id)).toBe(2)

    const sent = await messages(fixture.alpha.propertyId)
    expect(sent.map((m) => m.recipient)).toEqual([STAFF])
    expect(sent[0]!.payload).toMatchObject({
      authority: 'questura',
      subject: 'hotel-alpha guest',
      url: `${APP_URL}/en/hotel-alpha/console/arrivals/${fixture.alpha.reservationId}`,
      manual: false,
    })

    const [event] = await db.execute<{ payload: Record<string, unknown> }>(sql`
      select payload from domain_events
       where entity_id = ${id} and event_type = 'compliance_obligation.alerted'`)
    expect(event!.payload).toMatchObject({
      fromRung: 0,
      toRung: 2,
      reaches: ['inbox', 'staff'],
      messages: 1,
    })

    // The same sweep again, a minute later: nothing new.
    const again = await alertDueObligations(deps, {
      limit: 50,
      appUrl: APP_URL,
      now: new Date(now.getTime() + 60_000),
    })
    expect(again.alerted).toBe(0)
    expect(await messages(fixture.alpha.propertyId)).toHaveLength(1)
  })

  it('two sweeps at once send the owner one message, not two', async () => {
    await clearAlerts()
    const now = new Date()
    const id = await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + 2.5 * HOUR),
    )

    const [a, b] = await Promise.all([
      alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now }),
      alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now }),
    ])

    expect(a.alerted + b.alerted).toBe(1)
    expect(await rungOf(id)).toBe(3)
    // Staff and owner together — a late start fires both — and each once.
    expect((await messages(fixture.alpha.propertyId)).map((m) => m.recipient).sort()).toEqual(
      [OWNER, STAFF].sort(),
    )
    const [count] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from domain_events
       where entity_id = ${id} and event_type = 'compliance_obligation.alerted'`)
    expect(count!.n).toBe(1)
  })

  it('a hand-over pages the staff at once, and says it must be filed by hand', async () => {
    await clearAlerts()
    const now = new Date()
    const id = await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + 20 * HOUR),
      'manual',
    )

    await alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now })
    expect(await rungOf(id)).toBe(2)
    const sent = await messages(fixture.alpha.propertyId)
    expect(sent.map((m) => m.recipient)).toEqual([STAFF])
    expect(sent[0]!.payload).toMatchObject({ manual: true })
  })

  it('a hand-over after the owner rung fired pages staff and owner again, once', async () => {
    await clearAlerts()
    const now = new Date()
    // Alloggiati hands over two hours out: the staff and owner rungs have
    // already fired, telling them the filing would go by itself.
    const id = await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + 2 * HOUR),
      'manual',
    )
    await db.execute(sql`
      update compliance_obligations
         set alert_rung = 3,
             alerted_at = ${new Date(now.getTime() - HOUR).toISOString()},
             state_changed_at = ${new Date(now.getTime() - 60_000).toISOString()}
       where id = ${id}`)

    // Two sweeps at once: the rung cannot move, so the timestamp is the claim.
    const [a, b] = await Promise.all([
      alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now }),
      alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now }),
    ])
    expect(a.alerted + b.alerted).toBe(1)

    const sent = await messages(fixture.alpha.propertyId)
    expect(sent.map((m) => m.recipient).sort()).toEqual([OWNER, STAFF].sort())
    for (const m of sent) expect(m.payload).toMatchObject({ manual: true })

    const [event] = await db.execute<{ payload: Record<string, unknown> }>(sql`
      select payload from domain_events
       where entity_id = ${id} and event_type = 'compliance_obligation.alerted'`)
    expect(event!.payload).toMatchObject({
      fromRung: 3,
      toRung: 3,
      handover: true,
      reaches: ['staff', 'owner'],
    })

    const again = await alertDueObligations(deps, {
      limit: 50,
      appUrl: APP_URL,
      now: new Date(now.getTime() + 5 * 60_000),
    })
    expect(again.alerted).toBe(0)
    expect(await messages(fixture.alpha.propertyId)).toHaveLength(2)
  })

  it('never after the deadline, never for a filing the authority has', async () => {
    await clearAlerts()
    const now = new Date()
    const expired = await obligation(fixture.alpha.propertyId, null, new Date(now.getTime() - HOUR))
    const filed = await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + HOUR),
      'submitted',
    )

    const result = await alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now })
    expect(result.alerted).toBe(0)
    expect(await rungOf(expired)).toBe(0)
    expect(await rungOf(filed)).toBe(0)
    expect(await messages(fixture.alpha.propertyId)).toHaveLength(0)
  })

  it('with no messaging channel on, the rung still rises and the event says nobody was paged', async () => {
    await clearAlerts()
    const now = new Date()
    const id = await obligation(
      fixture.beta.propertyId,
      fixture.beta.reservationId,
      new Date(now.getTime() + 5 * HOUR),
    )

    await alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now })
    expect(await rungOf(id)).toBe(2)
    expect(await messages(fixture.beta.propertyId)).toHaveLength(0)

    const [event] = await db.execute<{ payload: Record<string, unknown> }>(sql`
      select payload from domain_events
       where entity_id = ${id} and event_type = 'compliance_obligation.alerted'`)
    expect(event!.payload).toMatchObject({ messages: 0, unreachable: 1 })
  })

  it('a property with the filing feature off is not paged (ADR-019)', async () => {
    await clearAlerts()
    await revokeEntitlement({ propertyId: fixture.beta.propertyId, feature: 'alloggiati' })
    try {
      const now = new Date()
      const id = await obligation(
        fixture.beta.propertyId,
        fixture.beta.reservationId,
        new Date(now.getTime() + 2 * HOUR),
      )
      const result = await alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now })
      expect(result.alerted).toBe(0)
      expect(await rungOf(id)).toBe(0)
    } finally {
      await grantEntitlement({ propertyId: fixture.beta.propertyId, feature: 'alloggiati' })
    }
  })
})

describe('the inbox rung and the owner lists', () => {
  it('shows an alerted or overdue filing to its own members only', async () => {
    await clearAlerts()
    const now = new Date()
    const alerted = await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + 10 * HOUR),
    )
    const quiet = await obligation(
      fixture.alpha.propertyId,
      null,
      new Date(now.getTime() + 20 * HOUR),
    )
    const overdue = await obligation(fixture.alpha.propertyId, null, new Date(now.getTime() - HOUR))
    await alertDueObligations(deps, { limit: 50, appUrl: APP_URL, now })

    const inbox = await listExceptions(fixture.alpha.user.id, fixture.alpha.propertyId, now)
    const ids = inbox.filter((item) => item.kind === 'compliance-deadline').map((item) => item.id)
    expect(ids.sort()).toEqual([`compliance:${alerted}`, `compliance:${overdue}`].sort())
    expect(ids).not.toContain(`compliance:${quiet}`)
    // Review opens the stay; a filing with no stay has nothing to open.
    const byId = new Map(inbox.map((item) => [item.id, item]))
    expect(byId.get(`compliance:${alerted}`)!.reservationId).toBe(fixture.alpha.reservationId)
    expect(byId.get(`compliance:${overdue}`)!.reservationId).toBeNull()

    // Beta's owner, asking for alpha's inbox, gets nothing from it (RLS).
    const crossed = await listExceptions(fixture.beta.user.id, fixture.alpha.propertyId, now)
    expect(crossed.filter((item) => item.kind === 'compliance-deadline')).toEqual([])

    // The client path agrees: the new columns are readable to members only.
    const rows = (await selectAs(
      fixture.beta.user,
      'compliance_obligations',
      'select=id,alert_rung',
    )) as {
      id: string
    }[]
    expect(rows.map((row) => row.id)).not.toContain(alerted)
  })

  it("lists the owner's due and failed filings, scoped to the property", async () => {
    await clearAlerts()
    const now = new Date()
    await obligation(
      fixture.alpha.propertyId,
      fixture.alpha.reservationId,
      new Date(now.getTime() + 3 * HOUR),
    )
    await obligation(fixture.alpha.propertyId, null, new Date(now.getTime() + 6 * HOUR), 'manual')
    await obligation(
      fixture.alpha.propertyId,
      null,
      new Date(now.getTime() + 6 * HOUR),
      'acknowledged',
    )
    await obligation(
      fixture.beta.propertyId,
      fixture.beta.reservationId,
      new Date(now.getTime() + HOUR),
      'failed',
    )

    const due = await listObligationsForOwner(fixture.alpha.propertyId, 'due')
    expect(due.map((row) => row.state)).toEqual(['pending', 'manual'])
    expect(due[0]!.subject).toBe('hotel-alpha guest')

    const failed = await listObligationsForOwner(fixture.alpha.propertyId, 'failed')
    expect(failed.map((row) => row.state)).toEqual(['manual'])
  })
})
