import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import {
  assessTargets,
  filingSlaByProperty,
  firstActivityWeek,
  weeklyPilotReport,
} from '../../../pilot/weekly'

/**
 * WP1.7's weekly pilot report against a real database: one property's week
 * of guest messages, model cost, phone alerts and filings, counted in the
 * property's own days, and nothing of another property's.
 *
 * The week is Monday 28 September to Sunday 4 October 2026, Europe/Rome.
 */
let fixture: Fixture
const now = new Date('2026-10-05T08:00:00Z')
const PHRASE = 'La colazione è servita dalle sette.'

async function thread(propertyId: string, escalatedAt: string | null = null): Promise<string> {
  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name) values (${propertyId}, 'Weekly guest') returning id`,
  )
  const [stay] = await db.execute<{ id: string }>(sql`
    insert into reservations (property_id, guest_id, arrival_date, departure_date, status, pax)
    values (${propertyId}, ${guest!.id}, '2026-09-28', '2026-10-03', 'confirmed', '{"adults":1,"children":0}'::jsonb)
    returning id`)
  const [row] = await db.execute<{ id: string }>(sql`
    insert into message_threads (property_id, reservation_id, locale, escalated_at)
    values (${propertyId}, ${stay!.id}, 'it', ${escalatedAt}) returning id`)
  return row!.id
}

async function message(
  propertyId: string,
  threadId: string,
  author: 'guest' | 'agent' | 'staff',
  at: string,
  runId: string | null = null,
  body = author === 'agent' ? PHRASE : 'Messaggio',
) {
  await db.execute(sql`
    insert into messages (property_id, thread_id, author, body, agent_run_id, created_at)
    values (${propertyId}, ${threadId}, ${author}, ${body}, ${runId}, ${at})`)
}

async function run(propertyId: string, at: string, costCents: number): Promise<string> {
  const [row] = await db.execute<{ id: string }>(sql`
    insert into agent_runs (agent, property_id, tier_applied, tool_calls, cost_cents, at)
    values ('AG-01', ${propertyId}, 'T1',
            ${JSON.stringify([{ tool: 'kb_answer', output: { phrase: PHRASE } }])}::jsonb,
            ${costCents}, ${at})
    returning id`)
  return row!.id
}

async function alert(propertyId: string, channel: string, at: string) {
  await db.execute(sql`
    insert into notifications (property_id, channel, template, locale, recipient, alert, created_at)
    values (${propertyId}, ${channel}, 'compliance_alert', 'it', '+390400000002', true, ${at})`)
}

async function obligation(propertyId: string, state: string, deadline: string, changed: string) {
  await db.execute(sql`
    insert into compliance_obligations
      (property_id, adapter_id, authority, type, subject_key, deadline, state, state_changed_at)
    values (${propertyId}, 'alloggiati', 'questura', 'guest_registration',
            ${`reservation:${crypto.randomUUID()}`}, ${deadline}, ${state}, ${changed})`)
}

beforeAll(async () => {
  fixture = await seed()
  const alpha = fixture.alpha.propertyId
  const beta = fixture.beta.propertyId

  // Thread A: two turns, answered in 10 s and 80 s; an exchange the week before.
  const a = await thread(alpha)
  await message(alpha, a, 'guest', '2026-09-27T10:00:00Z')
  await message(
    alpha,
    a,
    'agent',
    '2026-09-27T10:00:05Z',
    await run(alpha, '2026-09-27T10:00:04Z', 7),
  )
  await message(alpha, a, 'guest', '2026-09-29T10:00:00Z')
  await message(
    alpha,
    a,
    'agent',
    '2026-09-29T10:00:10Z',
    await run(alpha, '2026-09-29T10:00:09Z', 30),
  )
  await message(alpha, a, 'guest', '2026-09-29T10:05:00Z')
  await message(alpha, a, 'guest', '2026-09-29T10:06:00Z') // same turn
  await message(
    alpha,
    a,
    'agent',
    '2026-09-29T10:06:20Z',
    await run(alpha, '2026-09-29T10:06:19Z', 20),
  )

  // Thread B: escalated, answered by staff in 120 s.
  const b = await thread(alpha, '2026-09-30T12:01:00Z')
  await message(alpha, b, 'guest', '2026-09-30T12:00:00Z')
  await message(alpha, b, 'staff', '2026-09-30T12:02:00Z')

  // Thread C: not answered yet.
  const c = await thread(alpha)
  await message(alpha, c, 'guest', '2026-10-01T09:00:00Z')

  // Cost outside the week, and alerts: one phone alert in the week, one email, one the week after.
  await run(alpha, '2026-10-06T09:00:00Z', 999)
  await alert(alpha, 'sms', '2026-10-02T08:00:00Z')
  await alert(alpha, 'email', '2026-10-02T08:00:00Z')
  await alert(alpha, 'whatsapp', '2026-10-06T08:00:00Z')

  // Filings: one on time, one missed; one the week after.
  await obligation(alpha, 'acknowledged', '2026-09-30T10:00:00Z', '2026-09-29T10:00:00Z')
  await obligation(alpha, 'manual', '2026-10-02T10:00:00Z', '2026-10-02T07:00:00Z')
  await obligation(alpha, 'pending', '2026-10-07T10:00:00Z', '2026-10-05T07:00:00Z')

  // Beta, in the same week: an unsourced reply, which alpha never counts.
  const other = await thread(beta)
  await message(beta, other, 'guest', '2026-09-29T10:00:00Z')
  await message(beta, other, 'agent', '2026-09-29T10:00:05Z', null, 'Costa 90 euro.')
  await obligation(beta, 'manual', '2026-09-30T10:00:00Z', '2026-09-30T07:00:00Z')
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('the weekly pilot report', () => {
  it('counts one property’s week, in its own days', async () => {
    const report = await weeklyPilotReport(fixture.alpha.propertyId, {
      weekStart: '2026-09-28',
      timeZone: 'Europe/Rome',
      now,
    })

    expect(report.weekEnd).toBe('2026-10-04')
    expect(report.filings).toEqual([
      { authority: 'questura', due: 2, onTime: 1, late: 0, missed: 1, byHand: 0, notYetDue: 0 },
    ])
    expect(report.desk).toEqual({
      threads: 3,
      turns: 4,
      unansweredTurns: 1,
      medianFirstResponseSeconds: 80,
      autoResolved: 1,
      autoResolutionRate: 1 / 3,
      escalations: 1,
      phoneAlerts: 1,
      interruptions: 2,
      costCents: 50,
      costPerThreadCents: 17,
      repliesChecked: 2,
      unsafeActions: 0,
    })
    expect(assessTargets(report).missedFilings).toBe('missed')
  })

  it('never counts another property’s messages, costs or audit findings', async () => {
    const beta = await weeklyPilotReport(fixture.beta.propertyId, {
      weekStart: '2026-09-28',
      timeZone: 'Europe/Rome',
      now,
    })
    expect(beta.desk).toMatchObject({ threads: 1, turns: 1, costCents: 0, unsafeActions: 1 })
  })

  it('knows the first week, for the interruptions baseline', async () => {
    expect(await firstActivityWeek(fixture.alpha.propertyId, 'Europe/Rome')).toBe('2026-09-21')
  })

  it('gives the operator the week’s filings across properties', async () => {
    const sla = await filingSlaByProperty({ days: 7, now })
    const byProperty = Object.fromEntries(sla.map((row) => [row.propertyId, row.missed]))
    expect(byProperty).toEqual({ [fixture.alpha.propertyId]: 1, [fixture.beta.propertyId]: 1 })
  })
})
