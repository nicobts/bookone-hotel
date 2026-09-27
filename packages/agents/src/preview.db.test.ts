import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeConnection, db } from '@bookone/core/db'
import { NotADemoProperty, readRunByRequest } from '@bookone/core/preview'
import { listPendingApprovals } from '@bookone/core/concierge'
import type { LlmProvider } from '@bookone/core/llm'
import { runAgent } from './runner'
import { previewGuestTurn } from './preview'

/**
 * The agent playground against a real database (ADR-037): it refuses any
 * property that is not a demo one before writing anything, and on a demo one a
 * turn is a real turn — what it returns is what the thread and `agent_runs`
 * hold. No model is registered here, so a money request exercises the hard
 * rule, which is code and needs none.
 */
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
const ids: { property: string; reservation: string }[] = []
const ownerId = randomUUID()
let ownerCreated = false

async function stay(demo: boolean) {
  const slug = `preview-${randomUUID().slice(0, 8)}`
  const [property] = await db.execute<{ id: string }>(sql`
    insert into properties (slug, name, settings)
    values (${slug}, 'Preview Test', ${JSON.stringify(demo ? { demo: true } : {})}::jsonb)
    returning id`)
  const propertyId = property!.id
  for (const feature of ['inbox', 'concierge']) {
    await db.execute(
      sql`insert into entitlements (property_id, feature) values (${propertyId}, ${feature})`,
    )
  }
  const [roomType] = await db.execute<{ id: string }>(
    sql`insert into room_types (property_id, code, capacity) values (${propertyId}, 'DBL', 2) returning id`,
  )
  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name, locale) values (${propertyId}, 'Eva Test', 'it') returning id`,
  )
  const [reservation] = await db.execute<{ id: string }>(sql`
    insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date, status, pax)
    values (${propertyId}, ${guest!.id}, ${roomType!.id}, ${tomorrow}, ${later}, 'confirmed', '{"adults":2}'::jsonb)
    returning id`)
  if (!ownerCreated) {
    await db.execute(
      sql`insert into auth.users (id, email, aud, role) values (${ownerId}, ${`${ownerId}@preview.test`}, 'authenticated', 'authenticated')`,
    )
    ownerCreated = true
  }
  await db.execute(
    sql`insert into property_members (property_id, user_id, role) values (${propertyId}, ${ownerId}, 'owner')`,
  )
  const entry = { property: propertyId, reservation: reservation!.id }
  ids.push(entry)
  return entry
}

afterAll(async () => {
  for (const { property } of ids) {
    await db.execute(sql`delete from domain_events where property_id = ${property}`)
    await db.execute(sql`delete from agent_runs where property_id = ${property}`)
    await db.execute(sql`delete from properties where id = ${property}`)
  }
  await db.execute(sql`delete from auth.users where id = ${ownerId}`)
  await closeConnection()
})

describe('agent playground (ADR-037)', () => {
  it('refuses a property that is not a demo one, and writes nothing', async () => {
    const real = await stay(false)
    await expect(
      previewGuestTurn({
        propertyId: real.property,
        reservationId: real.reservation,
        message: 'Voglio un rimborso.',
        locale: 'it',
        appUrl: 'http://app.test',
      }),
    ).rejects.toBeInstanceOf(NotADemoProperty)

    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from messages where property_id = ${real.property}`,
    )
    expect(row!.n).toBe(0)
  })

  it('runs a real turn on a demo property and returns what it recorded', async () => {
    const demo = await stay(true)
    const turn = await previewGuestTurn({
      propertyId: demo.property,
      reservationId: demo.reservation,
      message: 'Voglio un rimborso.',
      locale: 'it',
      appUrl: 'http://app.test',
    })

    // Money is a hard rule: a person, never the assistant (ADR-021).
    expect(turn.outcome).toBe('escalated')
    expect(turn.run).toMatchObject({ agent: 'AG-01', hardRule: 'money', tier: 'T2' })

    // What the playground shows is what the thread holds, after the guest's message.
    const stored = await db.execute<{ author: string; body: string }>(sql`
      select author::text as author, body from messages
       where property_id = ${demo.property} and author <> 'guest'
       order by created_at, id`)
    expect(turn.replies.map((r) => r.body).sort()).toEqual(stored.map((m) => m.body).sort())
    expect(turn.replies.length).toBeGreaterThan(0)
  })
})

describe('console preview on a real property (ADR-038)', () => {
  /** A model that routes to one profile and picks one tool. */
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
            ? [
                {
                  name: 'route',
                  input: { profile, emergency: false, money: false, identity: false },
                },
              ]
            : [{ name: tool, input }],
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
        model: 'fake',
        stopReason: 'tool_use',
      }),
    }
  }

  async function count(table: string, propertyId: string): Promise<number> {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where property_id = ${propertyId}`,
    )
    return row!.n
  }

  it('simulates an action: no complaint, no message, but a recorded, readable run', async () => {
    const real = await stay(false)
    const requestId = randomUUID()

    const run = await runAgent(
      {
        agent: 'AG-01',
        propertyId: real.property,
        reservationId: real.reservation,
        locale: 'it',
        appUrl: 'http://app.test',
        preview: true,
        inputRef: requestId,
        input: { message: 'La camera è sporca', history: [], hasBooking: true },
      },
      undefined,
      async () => true,
      model('complaints', 'log_complaint', { category: 'cleanliness', summary: 'Camera sporca' }),
    )

    expect(await count('complaints', real.property)).toBe(0)
    expect(await count('messages', real.property)).toBe(0)
    expect(await count('notifications', real.property)).toBe(0)

    const read = await readRunByRequest(ownerId, real.property, requestId)
    expect(read).toMatchObject({ runId: run.runId, profile: 'complaints' })
    expect(read!.tools).toContainEqual({ tool: 'log_complaint', status: 'simulated' })
    expect(read!.reply).toMatch(/Anteprima/)
  })

  it('never leaves an approval pending from a preview', async () => {
    const real = await stay(false)
    await runAgent(
      {
        agent: 'AG-01',
        propertyId: real.property,
        reservationId: real.reservation,
        locale: 'it',
        preview: true,
        inputRef: randomUUID(),
        input: { message: 'Possiamo fare il check-out alle 13?', history: [], hasBooking: true },
      },
      undefined,
      async () => true,
      model('checkout', 'request_late_checkout', { time: '13:00' }),
    )

    expect(await listPendingApprovals(real.property)).toEqual([])
    expect(await count('stay_tasks', real.property)).toBe(0)
  })
})
