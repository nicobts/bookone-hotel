import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appendGuestMessage,
  decideApproval,
  listBreachedComplaints,
  listPendingApprovals,
  listThreadActions,
  logComplaint,
  markComplaintBreachAlerted,
  pausedPhrase,
  reverseAction,
  takeOverThread,
} from '@bookone/core/concierge'
import { db, closeConnection } from '@bookone/core/db'
import { agentActor } from '@bookone/core/events'
import type { LlmProvider } from '@bookone/core/llm'
import { respondToGuestMessage } from './concierge'
import { runAgent } from './runner'

/**
 * The inbox against a real database (Guest Desk WP0.6): approvals decided once,
 * reversals that really undo, the agent silenced when a person takes the
 * thread, complaint SLA breaches found once. Own property and user, removed
 * at the end.
 */
const slug = `inbox-${randomUUID().slice(0, 8)}`
const userId = randomUUID()
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)

let propertyId: string
let reservationId: string
let threadId: string

/** A model that routes to one profile and picks one tool — the adversary is not needed here. */
function model(profile: string, tool: string, input: Record<string, unknown>): LlmProvider {
  return {
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
          ? [{ name: 'route', input: { profile, emergency: false, money: false, identity: false } }]
          : [{ name: tool, input }],
      usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
      model: 'fake',
      stopReason: 'tool_use',
    }),
  }
}

const turn = (message: string) => ({
  agent: 'AG-01',
  propertyId,
  reservationId,
  threadId,
  locale: 'en',
  input: { message },
})

beforeAll(async () => {
  await db.execute(
    sql`insert into auth.users (id, email, aud, role) values (${userId}, ${`${slug}@inbox.test`}, 'authenticated', 'authenticated')`,
  )
  const [property] = await db.execute<{ id: string }>(
    sql`insert into properties (slug, name) values (${slug}, 'Inbox Test') returning id`,
  )
  propertyId = property!.id
  for (const feature of ['inbox', 'concierge']) {
    await db.execute(
      sql`insert into entitlements (property_id, feature) values (${propertyId}, ${feature})`,
    )
  }

  const [roomType] = await db.execute<{ id: string }>(
    sql`insert into room_types (property_id, code, capacity) values (${propertyId}, 'DBL', 2) returning id`,
  )
  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name) values (${propertyId}, 'Eva Test') returning id`,
  )
  const [reservation] = await db.execute<{ id: string }>(
    sql`insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date, status, pax)
        values (${propertyId}, ${guest!.id}, ${roomType!.id}, ${tomorrow}, ${later}, 'confirmed', '{"adults":2}'::jsonb)
        returning id`,
  )
  reservationId = reservation!.id
  threadId = (await appendGuestMessage({ propertyId, reservationId, locale: 'en', body: 'Hello' }))
    .thread.id
})

afterAll(async () => {
  await db.execute(sql`delete from domain_events where property_id = ${propertyId}`)
  await db.execute(sql`delete from agent_runs where property_id = ${propertyId}`)
  await db.execute(sql`delete from properties where id = ${propertyId}`)
  await db.execute(sql`delete from auth.users where id = ${userId}`)
  await closeConnection()
})

describe('approvals', () => {
  it('lists a held action as pending, records a decision once, and never twice', async () => {
    const run = await runAgent(
      turn('Can we check out late, at 13:00?'),
      undefined,
      async () => true,
      model('checkout', 'request_late_checkout', { time: '13:00' }),
    )

    const pending = (await listPendingApprovals(propertyId)).find((p) => p.runId === run.runId)
    expect(pending).toMatchObject({
      tool: 'request_late_checkout',
      input: { time: '13:00' },
      threadId,
    })

    const first = await decideApproval({
      propertyId,
      runId: run.runId,
      decision: 'accepted',
      userId,
    })
    expect(first.status).toBe('decided')

    const second = await decideApproval({
      propertyId,
      runId: run.runId,
      decision: 'rejected',
      userId,
    })
    expect(second.status).toBe('rejected')

    const [row] = await db.execute<{ outcome: string; reviewed: string }>(
      sql`select outcome, reviewed_by as reviewed from agent_runs where id = ${run.runId}`,
    )
    expect(row).toEqual({ outcome: 'accepted', reviewed: userId })
    expect((await listPendingApprovals(propertyId)).some((p) => p.runId === run.runId)).toBe(false)
  })
})

describe('reversal', () => {
  it('undoes a date change by cancelling its task, once, as its own event', async () => {
    const run = await runAgent(
      turn('Can we change our dates?'),
      undefined,
      async () => true,
      model('booking-support', 'modify_booking', {
        arrival: tomorrow,
        departure: later,
        adults: 2,
      }),
    )

    const action = (await listThreadActions(propertyId, threadId))
      .get(run.runId)
      ?.find((a) => a.tool === 'modify_booking')
    expect(action?.canReverse).toBe(true)

    expect(
      await reverseAction({ propertyId, runId: run.runId, callIndex: action!.callIndex, userId }),
    ).toEqual({
      status: 'reversed',
    })
    expect(
      (await reverseAction({ propertyId, runId: run.runId, callIndex: action!.callIndex, userId }))
        .status,
    ).toBe('rejected')

    const after = (await listThreadActions(propertyId, threadId))
      .get(run.runId)
      ?.find((a) => a.tool === 'modify_booking')
    expect(after?.reversedAt).not.toBeNull()

    const [task] = await db.execute<{ status: string }>(
      sql`select status from stay_tasks where property_id = ${propertyId} and summary like 'Change request%'`,
    )
    expect(task!.status).toBe('cancelled')
  })
})

describe('the operator kill switch (WP0.8)', () => {
  it('answers with the paused phrase, hands the thread to a person, and runs no agent', async () => {
    await db.execute(
      sql`update properties set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('agentPausedAt', now()) where id = ${propertyId}`,
    )
    const [{ n: runsBefore }] = (await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs where property_id = ${propertyId}`,
    )) as unknown as [{ n: number }]

    const outcome = await respondToGuestMessage({
      propertyId,
      reservationId,
      threadId,
      locale: 'it',
      message: 'A che ora è la colazione?',
    })
    expect(outcome.status).toBe('paused')

    const said = await db.execute<{ author: string }>(
      sql`select author from messages where thread_id = ${threadId} and body = ${pausedPhrase('it')}`,
    )
    expect(said.map((m) => m.author)).toEqual(['system'])

    const [thread] = await db.execute<{ status: string }>(
      sql`select status from message_threads where id = ${threadId}`,
    )
    expect(thread!.status).toBe('escalated')

    const [{ n: runsAfter }] = (await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs where property_id = ${propertyId}`,
    )) as unknown as [{ n: number }]
    expect(runsAfter).toBe(runsBefore)

    await db.execute(
      sql`update properties set settings = settings - 'agentPausedAt' where id = ${propertyId}`,
    )
  })
})

describe('taking a conversation over', () => {
  it('silences the agent on that thread', async () => {
    await takeOverThread({ propertyId, threadId, userId })

    const outcome = await respondToGuestMessage({
      propertyId,
      reservationId,
      threadId,
      locale: 'en',
      message: 'What time is breakfast?',
    })

    expect(outcome.status).toBe('silenced')
  })
})

describe('complaint SLA breaches', () => {
  it('finds a complaint past its deadline once', async () => {
    const complaint = await logComplaint({
      propertyId,
      reservationId,
      category: 'noise',
      summary: 'Loud',
      actor: agentActor('AG-01'),
    })
    await db.execute(
      sql`update complaints set sla_due_at = now() - interval '1 minute' where id = ${complaint.id}`,
    )

    expect((await listBreachedComplaints(500)).map((c) => c.id)).toContain(complaint.id)
    await markComplaintBreachAlerted(propertyId, complaint.id)
    expect((await listBreachedComplaints(500)).map((c) => c.id)).not.toContain(complaint.id)
  })
})
