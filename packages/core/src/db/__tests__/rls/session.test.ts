import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeConnection, db } from '../../client'
import { asService, withUser } from '../../session'
import { expectPolicyRefusal, reset, seed, type Fixture } from './support'

/**
 * Isolation on the **application's own access path** — Drizzle over
 * DATABASE_URL (ADR-018).
 *
 * The companion suite (`client.test.ts`) covers the path a browser takes. That
 * one passing tells you nothing about this one: they authenticate differently
 * and, without `withUser`, only one of them has RLS applied at all.
 */

let fx: Fixture

beforeAll(async () => {
  fx = await seed()
}, 60_000)

afterAll(async () => {
  await reset()
  await closeConnection()
})

describe('the raw client leaks — which is why withUser exists', () => {
  /**
   * An odd-looking test that is the point of the file.
   *
   * It asserts the *unsafe* behaviour so that deleting `withUser`, or quietly
   * swapping a `withUser` call for a bare `db.select()`, fails loudly here
   * instead of failing open in production. If this test ever goes red because
   * the raw client stopped returning other properties' rows, do not delete it —
   * find out what changed, because every policy below depends on the answer.
   */
  it('returns every property to an unscoped query', async () => {
    const rows = await db.execute<{ id: string }>(sql`select id from properties`)

    expect(rows.length).toBe(2)
  })

  it('confirms the connecting role holds BYPASSRLS', async () => {
    const [role] = await db.execute<{ rolbypassrls: boolean }>(
      sql`select rolbypassrls from pg_roles where rolname = current_user`,
    )

    expect(role?.rolbypassrls).toBe(true)
  })
})

describe('withUser applies the policies', () => {
  it('shows a member only their own property', async () => {
    const rows = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ id: string; slug: string }>(sql`select id, slug from properties`),
    )

    expect(rows.map((r) => r.slug)).toEqual(['hotel-alpha'])
  })

  it('returns zero rows for another property, not an error', async () => {
    // Zero rows is the correct answer. An error would mean the policy was never
    // exercised and the query is wrong; a filtered subset would mean the policy
    // is partially applied, which is worse than absent because it looks right.
    const rows = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute(sql`select id from reservations where property_id = ${fx.beta.propertyId}`),
    )

    expect(rows.length).toBe(0)
  })

  it('hides another property’s guests', async () => {
    const rows = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ name: string }>(sql`select name from guests`),
    )

    expect(rows.map((r) => r.name)).toEqual(['hotel-alpha guest'])
  })

  it('refuses to write a row into another property', async () => {
    const message = await expectPolicyRefusal(() =>
      withUser(fx.alpha.user.id, (tx) =>
        tx.execute(
          sql`insert into reservations (property_id, arrival_date, departure_date)
              values (${fx.beta.propertyId}, '2026-10-01', '2026-10-02')`,
        ),
      ),
    )

    expect(message).toMatch(/row-level security policy for table "reservations"/)
  })

  it('refuses to move one of its own rows into another property', async () => {
    // The failure `with check` exists to stop. Without it the row passes
    // `using` on the way in and lands where the member cannot write — a tenant
    // breach committed with an ordinary UPDATE.
    const message = await expectPolicyRefusal(() =>
      withUser(fx.alpha.user.id, (tx) =>
        tx.execute(
          sql`update reservations set property_id = ${fx.beta.propertyId}
              where id = ${fx.alpha.reservationId}`,
        ),
      ),
    )

    expect(message).toMatch(/row-level security policy for table "reservations"/)
  })

  it('drops the privileged role inside the transaction', async () => {
    const [role] = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ current_role: string }>(sql`select current_role`),
    )

    expect(role?.current_role).toBe('authenticated')
  })

  it('does not leak one identity into the next transaction', async () => {
    // `set local` scopes the claim to the transaction. If it were session-scoped
    // a pooled connection would carry alpha's identity into beta's request —
    // the specific failure this shape exists to prevent.
    const alpha = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ slug: string }>(sql`select slug from properties`),
    )
    const beta = await withUser(fx.beta.user.id, (tx) =>
      tx.execute<{ slug: string }>(sql`select slug from properties`),
    )

    expect(alpha.map((r) => r.slug)).toEqual(['hotel-alpha'])
    expect(beta.map((r) => r.slug)).toEqual(['hotel-beta'])
  })

  it('restores the privileged role afterwards', async () => {
    await withUser(fx.alpha.user.id, (tx) => tx.execute(sql`select 1`))

    const [role] = await db.execute<{ current_role: string }>(sql`select current_role`)
    expect(role?.current_role).toBe('postgres')
  })
})

describe('identity tables are isolated by person, not by property (ADR-017)', () => {
  it('shows a person only their own profile', async () => {
    const rows = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ user_id: string }>(sql`select user_id from profiles`),
    )

    expect(rows.map((r) => r.user_id)).toEqual([fx.alpha.user.id])
  })

  it('creates a profile automatically for every auth user', async () => {
    // Two users seeded, two profiles — the trigger fired. Lazy creation would
    // mean every caller handles "no profile yet", and one eventually will not.
    const rows = await asService((database) =>
      database.execute<{ count: string }>(sql`select count(*)::text as count from profiles`),
    )

    expect(rows[0]?.count).toBe('2')
  })
})

describe('append-only tables', () => {
  it('lets a member write an event for their own property', async () => {
    await withUser(fx.alpha.user.id, (tx) =>
      tx.execute(
        sql`insert into domain_events (property_id, entity_type, event_type, origin, actor)
            values (${fx.alpha.propertyId}, 'reservation', 'reservation.confirmed', 'platform',
                    ${'user:' + fx.alpha.user.id})`,
      ),
    )

    const rows = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ event_type: string }>(sql`select event_type from domain_events`),
    )

    expect(rows.map((r) => r.event_type)).toEqual(['reservation.confirmed'])
  })

  it('has no update or delete policy on the event log', async () => {
    const rows = await asService((database) =>
      database.execute<{ cmd: string }>(
        sql`select cmd from pg_policies where tablename = 'domain_events'`,
      ),
    )

    const commands = rows.map((r) => r.cmd).sort()
    expect(commands).toEqual(['INSERT', 'SELECT'])
  })
})

describe('the reconciliation surface', () => {
  it('shows a member only their own discrepancies', async () => {
    const rows = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ id: string }>(sql`select id from discrepancies`),
    )

    expect(rows.map((r) => r.id)).toEqual([fx.alpha.discrepancyId])
  })

  it('shows a member only their own reconciliation runs', async () => {
    const rows = await withUser(fx.beta.user.id, (tx) =>
      tx.execute<{ id: string }>(sql`select id from reconciliation_runs`),
    )

    expect(rows.map((r) => r.id)).toEqual([fx.beta.runId])
  })

  it('lets a member resolve their own discrepancy', async () => {
    // The one-tap resolution the exceptions inbox offers (PRD C1). If this
    // were not writable from a session the console could only ever display.
    await withUser(fx.alpha.user.id, (tx) =>
      tx.execute(
        sql`update discrepancies
            set status = 'explained', explanation = 'rate rounding', resolved_by = ${'user:' + fx.alpha.user.id}
            where id = ${fx.alpha.discrepancyId}`,
      ),
    )

    const [row] = await withUser(fx.alpha.user.id, (tx) =>
      tx.execute<{ status: string }>(
        sql`select status from discrepancies where id = ${fx.alpha.discrepancyId}`,
      ),
    )

    expect(row?.status).toBe('explained')
  })

  it('refuses to resolve another property’s discrepancy', async () => {
    // Zero rows updated rather than an error: the row is invisible, so the
    // UPDATE matches nothing. Either way it must not change.
    await withUser(fx.alpha.user.id, (tx) =>
      tx.execute(
        sql`update discrepancies set status = 'explained' where id = ${fx.beta.discrepancyId}`,
      ),
    )

    const [row] = await asService((database) =>
      database.execute<{ status: string }>(
        sql`select status from discrepancies where id = ${fx.beta.discrepancyId}`,
      ),
    )

    expect(row?.status).toBe('open')
  })

  it('has no insert policy — a person cannot fabricate a discrepancy', async () => {
    // A discrepancy is an observation that two systems disagree. A person
    // cannot observe that into existence, and a fabricated one would corrupt
    // the parity ratio the fiscal-core gate turns on (D11 condition C2).
    const message = await expectPolicyRefusal(() =>
      withUser(fx.alpha.user.id, (tx) =>
        tx.execute(
          sql`insert into discrepancies (property_id, run_id, entity_ref, class)
              values (${fx.alpha.propertyId}, ${fx.alpha.runId}, 'made:up', 'logic')`,
        ),
      ),
    )

    expect(message).toMatch(/row-level security policy for table "discrepancies"/)
  })
})
