import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import { withUser } from '../../session'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import {
  appendGuestMessage,
  appendStaffMessage,
  appendSystemMessage,
  createStayTask,
  escalateThread,
  getThreadForReservation,
  handBackThread,
  listMessages,
  listOverdueEscalations,
  listStayTasks,
  markSlaAlerted,
  MessageRejected,
  takeOverThread,
} from '../../../concierge/thread'
import { auditToolBoundary, propertiesWithAgentReplies } from '../../../concierge/audit'
import { searchKb } from '../../../concierge/kb'
import { grantEntitlement } from '../../../onboarding/entitlements'
import { listOpenComplaints, logComplaint } from '../../../concierge/complaints'
import { agentActor } from '../../../events/actor'

/**
 * Messaging, tasks and the tool-boundary audit against a real database
 * (E3.2, E3.3, E3.4).
 *
 * Two things this suite is for, and they are different.
 *
 * **Isolation.** A thread is a conversation with a named person about where they
 * are sleeping tonight. One property reading another's threads is the worst
 * leak in the schema so far, worse than the payment rows, and the only way to
 * demonstrate a policy works is to have a second property to fail against.
 *
 * **The status contract.** `awaiting_reply` means the guest is waiting on us and
 * `escalated` means they are waiting on a person. The SLA sweep and the console
 * queue are both built on that reading, so the transitions are asserted here
 * rather than inferred from the code that writes them.
 */

let fixture: Fixture

async function confirmedStay(propertyId: string, suffix: string): Promise<string> {
  const arrival = isoDate(Date.now())
  const departure = isoDate(Date.now() + 2 * 86_400_000)

  const [room] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = 'DBL'`,
  )

  const nights = []
  for (
    let t = Date.parse(`${arrival}T00:00:00Z`);
    t < Date.parse(`${departure}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    nights.push({ date, priceCents: 10_000, currency: 'EUR', snapshotId: `snap-${suffix}-${date}` })
  }

  const hold = await createHold({
    propertyId,
    roomTypeId: room!.id,
    arrival,
    departure,
    adults: 2,
    children: 0,
    nights,
  })
  if (hold.status !== 'held') throw new Error('fixture hold failed')

  await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: { name: 'Rosa Weber', email: `rosa-${suffix}@example.test`, locale: 'en' },
  })

  const confirmed = await confirmReservation({ propertyId, reservationId: hold.reservationId })
  if (confirmed.status !== 'confirmed') throw new Error(`fixture confirm: ${confirmed.status}`)

  return hold.reservationId
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * One breakfast article for a property.
 *
 * Idempotent, because several tests want the article to exist and the order
 * they run in is not something a suite should depend on. `on conflict do
 * nothing` rather than a per-test unique topic: the unique constraint is part
 * of what is being relied on here, and working around it in the fixture would
 * mean the tests no longer describe the real table.
 */
async function seedArticle(propertyId: string): Promise<void> {
  await db.execute(sql`
    insert into kb_articles (property_id, topic, question_variants, answers)
    values (
      ${propertyId},
      'breakfast',
      ${JSON.stringify(['what time is breakfast'])}::jsonb,
      ${JSON.stringify({ en: 'Breakfast is served from 07:30 to 10:00.' })}::jsonb
    )
    on conflict (property_id, topic) do nothing
  `)
}

beforeAll(async () => {
  fixture = await seed()
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('a thread', () => {
  it('opens on the first guest message and not before', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'open')

    expect(await getThreadForReservation(fixture.alpha.propertyId, reservationId)).toBeNull()

    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'What time is breakfast?',
    })

    expect(thread.status).toBe('awaiting_reply')
    expect(thread.lastGuestMessageAt).toBeInstanceOf(Date)
  })

  it('stays one thread when two messages arrive for the same stay', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'single')

    const first = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Hello',
    })
    const second = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Are you there?',
    })

    // A second thread would split the history the guest can see, which is the
    // one thing a conversation must not do.
    expect(second.thread.id).toBe(first.thread.id)
    expect(await listMessages(fixture.alpha.propertyId, first.thread.id)).toHaveLength(2)
  })

  it('refuses a message for a reservation belonging to another property', async () => {
    const reservationId = await confirmedStay(fixture.beta.propertyId, 'cross')

    await expect(
      appendGuestMessage({
        propertyId: fixture.alpha.propertyId,
        reservationId,
        locale: 'en',
        body: 'Hello',
      }),
    ).rejects.toBeInstanceOf(MessageRejected)
  })

  it('refuses an empty message and a novel-length one', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'bounds')

    for (const body of ['', '   ', 'x'.repeat(5_000)]) {
      await expect(
        appendGuestMessage({
          propertyId: fixture.alpha.propertyId,
          reservationId,
          locale: 'en',
          body,
        }),
      ).rejects.toBeInstanceOf(MessageRejected)
    }
  })
})

describe('taking over a conversation nobody escalated (WP0.6)', () => {
  it('works, and stamps the escalation time — it used to fail the check constraint', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'takeover-fresh')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Just saying hello',
    })

    await takeOverThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      userId: fixture.alpha.user.id,
    })

    const [row] = await db.execute<{ status: string; assigned: string; stamped: boolean }>(
      sql`select status, assigned_to as assigned, escalated_at is not null as stamped
          from message_threads where id = ${thread.id}`,
    )
    expect(row).toEqual({ status: 'escalated', assigned: fixture.alpha.user.id, stamped: true })
  })
})

describe('who owes the next reply', () => {
  it('goes back to awaiting_reply when the guest writes after an answer', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'reopen')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'First question',
    })

    await appendStaffMessage({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      userId: fixture.alpha.user.id,
      body: 'Here is the answer.',
    })

    const answered = await getThreadForReservation(fixture.alpha.propertyId, reservationId)
    expect(answered?.status).toBe('answered')

    const again = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'One more thing',
    })

    // A thread that stayed `answered` because the previous exchange concluded is
    // a thread the SLA sweep will never look at again.
    expect(again.thread.status).toBe('awaiting_reply')
  })

  it('keeps an escalated thread escalated when the guest writes again', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'nudge')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Can I bring my dog?',
    })

    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      reason: 'no stored answer',
    })
    await takeOverThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      userId: fixture.alpha.user.id,
    })

    const nudged = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Hello?',
    })

    // Taking a thread over is a commitment. A guest nudging must not silently
    // release it back into the unowned queue.
    expect(nudged.thread.status).toBe('escalated')
    expect(nudged.thread.assignedTo).toBe(fixture.alpha.user.id)
  })

  it('does not reset the escalation clock when the guest writes again', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'clock')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'A question',
    })

    const escalatedAt = new Date(Date.now() - 90 * 60_000)
    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      reason: 'no stored answer',
      at: escalatedAt,
    })

    await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Still waiting',
    })
    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      reason: 'still nothing',
    })

    const after = await getThreadForReservation(fixture.alpha.propertyId, reservationId)

    // Re-escalating would restart the SLA clock, so a thread somebody has been
    // ignoring for ninety minutes would look brand new every time the guest
    // nudged it — which is precisely backwards.
    expect(after?.escalatedAt?.getTime()).toBe(escalatedAt.getTime())
  })

  it('assigns the thread to whoever answers, button or no button', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'assign')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'A question',
    })

    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      reason: 'needs a person',
    })
    await appendStaffMessage({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      userId: fixture.alpha.user.id,
      body: 'Yes, dogs are fine.',
    })

    const after = await getThreadForReservation(fixture.alpha.propertyId, reservationId)

    expect(after?.assignedTo).toBe(fixture.alpha.user.id)
    expect(after?.escalationReason).toBeNull()
  })

  it('returns a handed-back thread to the queue rather than to the concierge', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'handback')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'A question',
    })

    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      reason: 'needs a person',
    })
    await takeOverThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      userId: fixture.alpha.user.id,
    })
    await handBackThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      userId: fixture.alpha.user.id,
    })

    const after = await getThreadForReservation(fixture.alpha.propertyId, reservationId)

    // Unowned and still escalated. Handing it back to the agent would be a loop
    // with a guest at the bottom of it.
    expect(after?.assignedTo).toBeNull()
    expect(after?.status).toBe('escalated')
  })
})

describe('the SLA sweep', () => {
  it('finds a thread nobody has answered and does not find a fresh one', async () => {
    const stale = await confirmedStay(fixture.alpha.propertyId, 'sla-stale')
    const fresh = await confirmedStay(fixture.alpha.propertyId, 'sla-fresh')

    const staleThread = (
      await appendGuestMessage({
        propertyId: fixture.alpha.propertyId,
        reservationId: stale,
        locale: 'en',
        body: 'Waited a long time',
      })
    ).thread
    const freshThread = (
      await appendGuestMessage({
        propertyId: fixture.alpha.propertyId,
        reservationId: fresh,
        locale: 'en',
        body: 'Just now',
      })
    ).thread

    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: staleThread.id,
      reason: 'x',
      at: new Date(Date.now() - 120 * 60_000),
    })
    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: freshThread.id,
      reason: 'x',
    })

    const overdue = await listOverdueEscalations({ minutes: 60 })
    const ids = overdue.map((row) => row.id)

    expect(ids).toContain(staleThread.id)
    expect(ids).not.toContain(freshThread.id)
  })

  it('alerts once, not on every sweep', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'sla-once')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Hello',
    })

    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      reason: 'x',
      at: new Date(Date.now() - 120 * 60_000),
    })

    expect((await listOverdueEscalations({ minutes: 60 })).map((r) => r.id)).toContain(thread.id)

    await markSlaAlerted(fixture.alpha.propertyId, thread.id)

    // A sweep that re-alerted every run would train an owner to ignore the
    // alert, which costs more than the missed reply it was warning about.
    expect((await listOverdueEscalations({ minutes: 60 })).map((r) => r.id)).not.toContain(
      thread.id,
    )
  })
})

describe('tasks', () => {
  it('records who asked, in the same vocabulary as the event log', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'task')

    await createStayTask({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      summary: 'Two more towels for room 4',
      actor: { kind: 'agent', agent: 'AG-01' },
    })

    const [row] = await db.execute<{ created_by: string }>(
      sql`select created_by from stay_tasks where reservation_id = ${reservationId}`,
    )

    expect(row?.created_by).toBe('agent:AG-01')

    const [event] = await db.execute<{ actor: string; event_type: string }>(
      sql`select actor, event_type from domain_events
          where event_type = 'task.created' and property_id = ${fixture.alpha.propertyId}
          order by id desc limit 1`,
    )

    expect(event?.actor).toBe('agent:AG-01')
  })

  it('lists a stay tasks and nobody else', async () => {
    const mine = await confirmedStay(fixture.alpha.propertyId, 'task-mine')
    const other = await confirmedStay(fixture.alpha.propertyId, 'task-other')

    await createStayTask({
      propertyId: fixture.alpha.propertyId,
      reservationId: mine,
      summary: 'Mine',
      actor: { kind: 'system' },
    })
    await createStayTask({
      propertyId: fixture.alpha.propertyId,
      reservationId: other,
      summary: 'Not mine',
      actor: { kind: 'system' },
    })

    const tasks = await listStayTasks(fixture.alpha.propertyId, mine)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.summary).toBe('Mine')
  })
})

describe('the knowledge base', () => {
  it('answers from the property own article', async () => {
    await seedArticle(fixture.alpha.propertyId)

    const found = await searchKb(fixture.alpha.propertyId, 'what time is breakfast?', 'en')

    expect(found?.answer).toContain('07:30')
  })

  it('does not answer from another property article', async () => {
    await seedArticle(fixture.alpha.propertyId)

    /*
     * The negative control for `loadArticles`. Removing the `property_id`
     * predicate from that query is a one-character mistake that would make one
     * hotel answer with another hotel's breakfast time — and every other test
     * in this file would still pass.
     */
    expect(await searchKb(fixture.beta.propertyId, 'what time is breakfast?', 'en')).toBeNull()
  })

  it('ignores an unpublished article', async () => {
    await db.execute(sql`
      insert into kb_articles (property_id, topic, question_variants, answers, published)
      values (
        ${fixture.beta.propertyId},
        'sauna',
        ${JSON.stringify(['is the sauna open'])}::jsonb,
        ${JSON.stringify({ en: 'The sauna is open 16:00 to 20:00.' })}::jsonb,
        false
      )
    `)

    // AG-03 will write drafts (Sprint 9). A draft the owner has not read must
    // not be quoted to a guest as the property's answer.
    expect(await searchKb(fixture.beta.propertyId, 'is the sauna open', 'en')).toBeNull()
  })
})

describe('the tool-boundary audit', () => {
  it('finds an unsourced reply that was actually sent', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'audit')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'What time is breakfast?',
    })

    // Written straight into the tables, which is the only way to produce this:
    // the shipping path cannot, because a reply is a tool phrase by
    // construction. That is exactly why the audit is worth having — it is what
    // notices when that stops being true.
    const [run] = await db.execute<{ id: string }>(sql`
      insert into agent_runs (agent, property_id, tool_calls, output, tier_applied, cost_cents, latency_ms)
      values ('AG-01', ${fixture.alpha.propertyId},
              ${JSON.stringify([{ tool: 'search_kb', ok: true }])}::jsonb,
              ${JSON.stringify({ phrase: 'Breakfast is served from 07:30 to 10:00.' })}::jsonb,
              'T1', 0, 12)
      returning id
    `)

    await db.execute(sql`
      insert into messages (property_id, thread_id, author, body, agent_run_id)
      values (${fixture.alpha.propertyId}, ${thread.id}, 'agent',
              'Breakfast is served until 11:00, and the sauna opens at 16:00.', ${run!.id})
    `)

    const report = await auditToolBoundary({
      propertyId: fixture.alpha.propertyId,
      since: new Date(Date.now() - 3_600_000),
    })

    expect(report.violations.map((v) => v.kind)).toContain('unsourced_reply')
    expect(report.violations.map((v) => v.detail)).toContain('11:00')
    expect(report.violations.map((v) => v.detail)).toContain('16:00')
  })

  it('reports the property that sent agent replies, and only that one', async () => {
    const properties = await propertiesWithAgentReplies(new Date(Date.now() - 3_600_000))

    expect(properties).toContain(fixture.alpha.propertyId)
    expect(properties).not.toContain(fixture.beta.propertyId)
  })
})

describe('isolation', () => {
  it('shows a member their own property threads', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'iso-own')
    await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Mine to read',
    })

    const rows = await selectAs(fixture.alpha.user, 'message_threads')

    expect(rows.length).toBeGreaterThan(0)
  })

  it('shows the other property none of them', async () => {
    /*
     * Zero rows, not an error. An error would mean the policy was never
     * exercised and the query is wrong — the distinction the add-table runbook
     * insists on, because a partially-applied policy looks correct.
     */
    const rows = await selectAs(fixture.beta.user, 'message_threads')

    expect(rows).toEqual([])
  })

  it('shows the other property none of the messages', async () => {
    expect(await selectAs(fixture.beta.user, 'messages')).toEqual([])
  })

  it('shows the other property none of the knowledge base', async () => {
    await seedArticle(fixture.alpha.propertyId)

    const rows = (await selectAs(fixture.beta.user, 'kb_articles')) as { topic: string }[]

    expect(rows.every((row) => row.topic !== 'breakfast')).toBe(true)
  })

  it('refuses a staff message written into another property thread', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'iso-write')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Hello',
    })

    await expectPolicyRefusal(() =>
      withUser(fixture.beta.user.id, (tx) =>
        tx.execute(sql`
          insert into messages (property_id, thread_id, author, body, author_user_id)
          values (${fixture.alpha.propertyId}, ${thread.id}, 'staff', 'I should not be here',
                  ${fixture.beta.user.id})
        `),
      ),
    )
  })

  it('refuses a message labelled as the agent by a person', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'iso-agent')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Hello',
    })

    /*
     * The one insert policy in the schema that constrains a column other than
     * `property_id`. A member of staff inserting a row labelled `agent` would
     * launder their own words into something the tool-boundary audit reads as
     * the software's output, and an owner reads as something the product said.
     */
    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into messages (property_id, thread_id, author, body)
          values (${fixture.alpha.propertyId}, ${thread.id}, 'agent', 'The product said this')
        `),
      ),
    )
  })

  it('refuses a staff message attributed to somebody else', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'iso-impersonate')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'Hello',
    })

    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into messages (property_id, thread_id, author, body, author_user_id)
          values (${fixture.alpha.propertyId}, ${thread.id}, 'staff', 'Signed by someone else',
                  ${fixture.beta.user.id})
        `),
      ),
    )
  })
})

describe('system notes', () => {
  it('does not take a thread out of the queue', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'system-note')
    const { thread } = await appendGuestMessage({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      locale: 'en',
      body: 'A question',
    })

    await appendSystemMessage({
      propertyId: fixture.alpha.propertyId,
      threadId: thread.id,
      body: 'You are messaging an assistant.',
    })

    const after = await getThreadForReservation(fixture.alpha.propertyId, reservationId)

    // Telling the guest they are talking to software is not answering them.
    // Marking the thread `answered` would take it out of the queue with the
    // question still open.
    expect(after?.status).toBe('awaiting_reply')
  })
})

/*
 * Last in the file on purpose: it gives beta a thread, and the isolation suite
 * above asserts beta has none of its own to see.
 */
describe('the SLA sweep, per feature (ADR-019)', () => {
  it('filters by feature before the batch limit, so one property cannot starve another', async () => {
    // ADR-019. Beta has the oldest overdue escalation of all and no `inbox`
    // feature. Filtering after the limit would hand the sweep beta's thread,
    // skip it, and do the same every five minutes forever — alpha's guest
    // would never be alerted on. The filter has to be in the query.
    const betaStay = await confirmedStay(fixture.beta.propertyId, 'sla-feature-beta')
    const betaThread = (
      await appendGuestMessage({
        propertyId: fixture.beta.propertyId,
        reservationId: betaStay,
        locale: 'en',
        body: 'Nobody here has the inbox',
      })
    ).thread
    await escalateThread({
      propertyId: fixture.beta.propertyId,
      threadId: betaThread.id,
      reason: 'x',
      at: new Date(Date.now() - 10_000 * 60_000),
    })

    const alphaStay = await confirmedStay(fixture.alpha.propertyId, 'sla-feature-alpha')
    const alphaThread = (
      await appendGuestMessage({
        propertyId: fixture.alpha.propertyId,
        reservationId: alphaStay,
        locale: 'en',
        body: 'Waiting',
      })
    ).thread
    await escalateThread({
      propertyId: fixture.alpha.propertyId,
      threadId: alphaThread.id,
      reason: 'x',
      at: new Date(Date.now() - 120 * 60_000),
    })

    await grantEntitlement({ propertyId: fixture.alpha.propertyId, feature: 'inbox' })

    // The control: unfiltered, beta's thread is first in line.
    const unfiltered = await listOverdueEscalations({ minutes: 60, limit: 1 })
    expect(unfiltered.map((row) => row.id)).toEqual([betaThread.id])

    const filtered = await listOverdueEscalations({ minutes: 60, limit: 1, feature: 'inbox' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.propertyId).toBe(fixture.alpha.propertyId)

    const all = await listOverdueEscalations({ minutes: 60, feature: 'inbox' })
    expect(all.map((row) => row.id)).not.toContain(betaThread.id)
    expect(all.map((row) => row.id)).toContain(alphaThread.id)
  })
})

/*
 * Complaints (Guest Desk WP0.3). Isolation on both paths, as the add-table
 * skill requires: the PostgREST client (`selectAs`) and Drizzle through
 * `withUser` (ADR-018) — a BYPASSRLS connection would pass the first and leak on
 * the second.
 */
describe('complaints', () => {
  it('keeps one property out of another, on both access paths', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'complaint-iso')
    const logged = await logComplaint({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      category: 'noise',
      summary: 'The bar was loud until 2am',
      actor: agentActor('AG-01'),
    })

    // Client path.
    expect(await selectAs(fixture.beta.user, 'complaints')).toEqual([])
    const own = await selectAs(fixture.alpha.user, 'complaints')
    expect(own.map((row) => (row as { id: string }).id)).toContain(logged.id)

    // Drizzle path, through the role drop.
    const seenByBeta = await withUser(fixture.beta.user.id, (tx) =>
      tx.execute(sql`select id from complaints where id = ${logged.id}`),
    )
    expect([...seenByBeta]).toEqual([])

    const seenByAlpha = await withUser(fixture.alpha.user.id, (tx) =>
      tx.execute(sql`select id from complaints where id = ${logged.id}`),
    )
    expect([...seenByAlpha]).toHaveLength(1)
  })

  it('refuses a complaint written into another property', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'complaint-cross')

    await expectPolicyRefusal(() =>
      withUser(fixture.beta.user.id, (tx) =>
        tx.execute(sql`
          insert into complaints (property_id, reservation_id, category, summary, sla_minutes, sla_due_at, created_by)
          values (${fixture.alpha.propertyId}, ${reservationId}, 'other', 'not mine', 30, now(), 'staff')
        `),
      ),
    )
  })

  it('cannot be deleted by a member — a resolved complaint is information', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'complaint-nodelete')
    const logged = await logComplaint({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      category: 'room',
      summary: 'The window does not close',
      actor: agentActor('AG-01'),
    })

    await withUser(fixture.alpha.user.id, (tx) =>
      tx.execute(sql`delete from complaints where id = ${logged.id}`),
    )

    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from complaints where id = ${logged.id}`,
    )
    expect(row!.n).toBe(1)
  })

  it('computes the deadline from the database clock: 5 minutes for safety, 30 otherwise', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId, 'complaint-sla')
    const safety = await logComplaint({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      category: 'safety',
      summary: 'The balcony railing is loose',
      actor: agentActor('AG-01'),
    })

    const [row] = await db.execute<{ minutes: number }>(
      sql`select extract(epoch from (sla_due_at - created_at))::int / 60 as minutes
          from complaints where id = ${safety.id}`,
    )
    expect(row!.minutes).toBe(5)
    expect(safety.slaMinutes).toBe(5)

    const open = await listOpenComplaints(fixture.alpha.propertyId)
    // Most urgent first: the five-minute safety complaint leads.
    expect(open[0]?.id).toBe(safety.id)
  })
})
