import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendGuestMessage, auditToolBoundary } from '@bookone/core/concierge'
import { respondToGuestMessage } from '../concierge'
import { db, closeConnection } from '@bookone/core/db'
import type { LlmProvider } from '@bookone/core/llm'
import { runAgent } from '../runner'
import { getTool, type ToolContext } from './index'

/**
 * The Guest Desk tools against a real database (WP0.3).
 *
 * One property of its own, created here and deleted at the end — never a
 * truncate, because core's suite owns the shared fixtures and runs first
 * (turbo `^test:rls`). Loopback only, like core's suite.
 */
const url = process.env.DATABASE_URL ?? ''
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  throw new Error('agents:db runs against a loopback database only')
}

const slug = `desk-${randomUUID().slice(0, 8)}`
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const inThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)

let context: ToolContext
let propertyId: string

beforeAll(async () => {
  const [property] = await db.execute<{ id: string }>(
    sql`insert into properties (slug, name, settings)
        values (${slug}, 'Desk Test', '{"contact": {"email": "manager@desk.test"}}'::jsonb)
        returning id`,
  )
  propertyId = property!.id

  const [roomType] = await db.execute<{ id: string }>(
    sql`insert into room_types (property_id, code, capacity, name_i18n)
        values (${propertyId}, 'DBL', 2, '{"en":"Double room","it":"Camera doppia"}'::jsonb) returning id`,
  )
  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name, email) values (${propertyId}, 'Ada Rossi', 'ada@desk.test') returning id`,
  )
  const [reservation] = await db.execute<{ id: string }>(
    sql`insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date,
                                  status, pax, total_cents, currency, reference)
        values (${propertyId}, ${guest!.id}, ${roomType!.id}, ${tomorrow}, ${inThreeDays}, 'confirmed',
                '{"adults":2,"children":0}'::jsonb, 36000, 'EUR', 'BO-DESK1')
        returning id`,
  )

  // A confirmed booking has a started journey — the booking confirmation does
  // this in production, and the journey machine refuses commands without one.
  await db.execute(
    sql`insert into journey_states (property_id, reservation_id) values (${propertyId}, ${reservation!.id})`,
  )

  const { thread } = await appendGuestMessage({
    propertyId,
    reservationId: reservation!.id,
    locale: 'en',
    body: 'Hello',
  })

  context = {
    propertyId,
    reservationId: reservation!.id,
    threadId: thread.id,
    locale: 'en',
    appUrl: 'https://bookone.test',
  }
})

afterAll(async () => {
  // Properties cascade to everything scoped to them; events carry the id too.
  await db.execute(sql`delete from domain_events where property_id = ${propertyId}`)
  await db.execute(sql`delete from agent_runs where property_id = ${propertyId}`)
  await db.execute(sql`delete from properties where id = ${propertyId}`)
  await closeConnection()
})

const run = (name: string, input: Record<string, unknown> = {}) =>
  getTool(name)!.run(context, input)

describe('money, from the booking row', () => {
  it('states what is paid against the total — here, nothing yet', async () => {
    const result = await run('get_payment_status')
    expect(result.ok).toBe(true)
    expect(result.output.phrase).toBe(
      'No payment has been recorded on your booking yet. The total is €360.00.',
    )
  })

  it('explains the total, the paid part and the balance', async () => {
    const result = await run('explain_charges')
    expect(String(result.output.phrase)).toContain('€360.00')
    expect(String(result.output.phrase)).toContain('€0.00 has been paid')
  })
})

describe('pre-arrival', () => {
  it('lists what is still missing', async () => {
    const result = await run('get_capture_status')
    expect(result.output.missing).toEqual(['details', 'documents'])
    expect(String(result.output.phrase)).toContain('your guest details, your identity documents')
  })

  it('records an arrival time through the journey machine', async () => {
    const result = await run('record_eta', { time: '21:30' })
    expect(result).toMatchObject({
      ok: true,
      output: { phrase: 'Noted: you expect to arrive around 21:30.' },
    })

    const [row] = await db.execute<{ t: string }>(
      sql`select expected_arrival_time as t from journey_states where reservation_id = ${context.reservationId}`,
    )
    expect(row!.t).toBe('21:30')
  })

  it('refuses a time a model made up in the wrong shape', async () => {
    expect((await run('record_eta', { time: '9pm' })).ok).toBe(false)
  })
})

describe('changes and requests go to a person', () => {
  it('records a date change as a task and hands off, never writing the booking', async () => {
    const result = await run('modify_booking', {
      arrival: tomorrow,
      departure: inThreeDays,
      adults: 3,
    })

    expect(result.output.handoff).toBe(true)
    // No rate cache in this fixture, so availability cannot be confirmed — and
    // the phrase says so rather than guessing.
    expect(result.output.available).toBe(false)

    const [task] = await db.execute<{ summary: string }>(
      sql`select summary from stay_tasks where id = ${String(result.output.taskId)}`,
    )
    expect(task!.summary).toContain('Change request')

    const [booking] = await db.execute<{ total: number }>(
      sql`select total_cents as total from reservations where id = ${context.reservationId}`,
    )
    expect(booking!.total).toBe(36000)
  })

  it('asks for a late checkout as a task', async () => {
    const result = await run('request_late_checkout', { time: '13:00' })
    expect(result.output).toMatchObject({ handoff: true })
  })
})

describe('the booking link', () => {
  it('refuses when the property has no booking engine', async () => {
    const result = await run('create_booking_link', {
      arrival: tomorrow,
      departure: inThreeDays,
      adults: 2,
    })
    expect(result).toMatchObject({ ok: false })
  })

  it('links to the property’s own booking page once it has one', async () => {
    await db.execute(
      sql`insert into entitlements (property_id, feature) values (${propertyId}, 'booking_engine')`,
    )

    const result = await run('create_booking_link', {
      arrival: tomorrow,
      departure: inThreeDays,
      adults: 2,
    })
    expect(result.ok).toBe(true)
    expect(String(result.output.url)).toBe(
      `https://bookone.test/en/book/${slug}?arrival=${tomorrow}&departure=${inThreeDays}&adults=2&children=0`,
    )
  })
})

describe('complaints', () => {
  it('logs one, alerts the manager and hands off', async () => {
    const result = await run('log_complaint', {
      category: 'noise',
      summary: 'Loud music next door',
    })
    expect(result.output).toMatchObject({ handoff: true, slaMinutes: 30 })

    const [row] = await db.execute<{ alerted: boolean }>(
      sql`select owner_alerted_at is not null as alerted from complaints where id = ${String(result.output.complaintId)}`,
    )
    expect(row!.alerted).toBe(true)
  })

  it('shows up in the owner’s list', async () => {
    const result = await run('list_open_complaints')
    expect(String(result.output.phrase)).toContain('Ada Rossi: noise')
  })
})

describe('the owner’s read-only lists', () => {
  it('lists tomorrow’s arrivals', async () => {
    expect(String((await run('list_arrivals')).output.phrase)).toContain('Ada Rossi')
  })

  it('lists who has not finished pre-arrival', async () => {
    expect(String((await run('list_capture_status')).output.phrase)).toContain('Ada Rossi')
  })

  it('says when a list of filings is not complete (WP1.5)', async () => {
    const deadline = new Date(Date.now() + 6 * 3_600_000).toISOString()
    for (let i = 0; i < 21; i++) {
      await db.execute(sql`
        insert into compliance_obligations
          (property_id, adapter_id, authority, type, subject_key, deadline, state)
        values (${propertyId}, 'alloggiati', 'questura', 'guest_registration',
                ${`period:truncation-${i}`}, ${deadline}, 'manual')`)
    }
    try {
      for (const tool of ['list_obligations_due', 'list_obligations_failed']) {
        const { output } = await run(tool)
        expect(output).toMatchObject({ count: 20, more: true })
        expect(String(output.phrase)).toContain('(20+)')
      }
    } finally {
      await db.execute(
        sql`delete from compliance_obligations where property_id = ${propertyId} and subject_key like 'period:truncation-%'`,
      )
    }
  })
})

describe('idempotency (WP0.3)', () => {
  it('does not execute the same write twice on one thread', async () => {
    // A model that picks the same complaint every time — a guest who sends the
    // same message twice, or a retried job.
    const llm: LlmProvider = {
      name: 'fake',
      residency: {
        euProcessing: true,
        region: 'test',
        subProcessorRegisterEntry: 'SP-006',
        verifiedAt: '2026-09-27',
      },
      complete: async (request) => ({
        text: '',
        toolCalls:
          request.task === 'classification'
            ? [
                {
                  name: 'route',
                  input: { profile: 'complaints', emergency: false, money: false, identity: false },
                },
              ]
            : [
                {
                  name: 'log_complaint',
                  input: { category: 'room', summary: 'The window does not close' },
                },
              ],
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
        model: 'fake',
        stopReason: 'tool_use',
      }),
    }

    const turn = {
      agent: 'AG-01',
      propertyId,
      reservationId: context.reservationId!,
      threadId: context.threadId!,
      locale: 'en',
      appUrl: context.appUrl!,
      input: { message: 'The window in my room does not close' },
    }

    await runAgent(turn, undefined, async () => true, llm)
    const second = await runAgent(turn, undefined, async () => true, llm)

    const [count] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from complaints
          where property_id = ${propertyId} and summary = 'The window does not close'`,
    )
    expect(count!.n).toBe(1)
    expect(second.toolCalls.map((c) => c.tool)).toContain('log_complaint')

    const [replayed] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs
          where property_id = ${propertyId} and tool_calls @> '[{"replayed": true}]'::jsonb`,
    )
    expect(replayed!.n).toBe(1)
  })
})

describe('the tool-boundary audit, on what was actually sent', () => {
  it('finds nothing unsourced in replies that join two tool phrases', async () => {
    // Through the real reply path: the guest message, the orchestrator, the
    // messages it writes. A complaint reply is the complaint phrase plus the
    // handover phrase — two tools, one message.
    const llm: LlmProvider = {
      name: 'fake',
      residency: {
        euProcessing: true,
        region: 'test',
        subProcessorRegisterEntry: 'SP-006',
        verifiedAt: '2026-09-27',
      },
      complete: async (request) => ({
        text: '',
        toolCalls:
          request.task === 'classification'
            ? [
                {
                  name: 'route',
                  input: { profile: 'complaints', emergency: false, money: false, identity: false },
                },
              ]
            : [
                {
                  name: 'log_complaint',
                  input: { category: 'cleanliness', summary: 'Hair in the shower' },
                },
              ],
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
        model: 'fake',
        stopReason: 'tool_use',
      }),
    }
    // The concierge is a feature (ADR-019). Without it the runner refuses the
    // turn — which is how this test first failed, correctly.
    await db.execute(
      sql`insert into entitlements (property_id, feature) values (${propertyId}, 'concierge')`,
    )

    const { registerProvider, clearProviders } = await import('@bookone/core/llm')
    registerProvider(llm)

    try {
      const outcome = await respondToGuestMessage({
        propertyId,
        reservationId: context.reservationId!,
        threadId: context.threadId!,
        locale: 'en',
        message: 'There is hair in the shower',
        appUrl: context.appUrl!,
      })
      expect(outcome.status).toBe('escalated')
    } finally {
      clearProviders()
    }

    const report = await auditToolBoundary({ propertyId, since: new Date(Date.now() - 3_600_000) })
    expect(report.checked).toBeGreaterThan(0)
    expect(report.violations).toEqual([])
  })
})
