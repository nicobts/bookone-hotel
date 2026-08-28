import { sql } from 'drizzle-orm'
import { db } from '../../client'

/**
 * Fixtures for the two isolation suites.
 *
 * Real auth users, created through the Auth admin API rather than by inserting
 * into `auth.users` directly: the column set there changes between Supabase
 * versions, and a fixture that breaks on upgrade gets deleted rather than
 * fixed. Driven over HTTP so this package gains no dependency on supabase-js
 * for a test (ADR-006 keeps that library to Auth/Storage/Realtime only).
 */

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54421'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Published in the CLI output and identical on every machine. Loopback only. */
export const TEST_PASSWORD = 'devpassword123!'

export interface TestUser {
  id: string
  email: string
  accessToken: string
}

function assertLoopback(): void {
  // These fixtures create users with a published password and then delete
  // every row in the public schema. Both are fine against a disposable local
  // database and catastrophic anywhere else.
  if (!/(127\.0\.0\.1|localhost|\[::1\])/.test(API_URL)) {
    throw new Error(`Isolation fixtures refuse to run against a non-loopback host: ${API_URL}`)
  }
}

async function authFetch(path: string, init: RequestInit & { key: string }): Promise<Response> {
  const { key, ...rest } = init
  return fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
  })
}

/** Creates a confirmed user and signs it in, returning a usable access token. */
export async function createUser(email: string): Promise<TestUser> {
  assertLoopback()

  const created = await authFetch('/auth/v1/admin/users', {
    key: SERVICE_KEY,
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD, email_confirm: true }),
  })

  if (!created.ok) {
    throw new Error(`createUser(${email}) failed: ${created.status} ${await created.text()}`)
  }

  const { id } = (await created.json()) as { id: string }

  const session = await authFetch('/auth/v1/token?grant_type=password', {
    key: ANON_KEY,
    method: 'POST',
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  })

  if (!session.ok) {
    throw new Error(`signIn(${email}) failed: ${session.status} ${await session.text()}`)
  }

  const { access_token: accessToken } = (await session.json()) as { access_token: string }
  return { id, email, accessToken }
}

/** Queries PostgREST as a signed-in user — the client access path. */
export async function selectAs(
  user: TestUser,
  table: string,
  query = 'select=*',
): Promise<unknown[]> {
  const res = await fetch(`${API_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
    },
  })

  if (!res.ok) {
    throw new Error(`selectAs(${table}) failed: ${res.status} ${await res.text()}`)
  }

  return (await res.json()) as unknown[]
}

export interface Fixture {
  alpha: PropertyFixture
  beta: PropertyFixture
}

export interface PropertyFixture {
  propertyId: string
  user: TestUser
  reservationId: string
  runId: string
  discrepancyId: string
}

/**
 * Two properties, two owners, one reservation each — the minimum that can show
 * isolation *failing*. A single-tenant fixture cannot: every query returns the
 * only rows there are, and a policy that does nothing looks identical to a
 * policy that works.
 */
export async function seed(): Promise<Fixture> {
  assertLoopback()
  await reset()

  const alphaUser = await createUser(`alpha-${Date.now()}@bookone.test`)
  const betaUser = await createUser(`beta-${Date.now()}@bookone.test`)

  const build = async (slug: string, user: TestUser) => {
    const [property] = await db.execute<{ id: string }>(
      sql`insert into properties (slug, name) values (${slug}, ${slug}) returning id`,
    )
    const propertyId = property!.id

    await db.execute(
      sql`insert into property_members (property_id, user_id, role)
          values (${propertyId}, ${user.id}, 'owner')`,
    )

    const [guest] = await db.execute<{ id: string }>(
      sql`insert into guests (property_id, name) values (${propertyId}, ${slug + ' guest'})
          returning id`,
    )

    const [reservation] = await db.execute<{ id: string }>(
      sql`insert into reservations (property_id, guest_id, arrival_date, departure_date, status)
          values (${propertyId}, ${guest!.id}, '2026-09-01', '2026-09-04', 'confirmed')
          returning id`,
    )

    // A reconciliation run and one open discrepancy, so the isolation suite
    // covers the reconciliation surface too. A table added without a matching
    // fixture is a table nobody proves is isolated.
    const [run] = await db.execute<{ id: string }>(
      sql`insert into reconciliation_runs (property_id, domain, parity_ratio, compared_count,
                                           discrepancies_count)
          values (${propertyId}, 'booking', 0.9990, 100, 1)
          returning id`,
    )

    const [discrepancy] = await db.execute<{ id: string }>(
      sql`insert into discrepancies (property_id, run_id, entity_ref, class, ours, theirs)
          values (${propertyId}, ${run!.id}, ${'reservation:' + reservation!.id}, 'rounding',
                  '{"totalCents":36000}'::jsonb, '{"totalCents":36001}'::jsonb)
          returning id`,
    )

    return {
      propertyId,
      user,
      reservationId: reservation!.id,
      runId: run!.id,
      discrepancyId: discrepancy!.id,
    }
  }

  return {
    alpha: await build('hotel-alpha', alphaUser),
    beta: await build('hotel-beta', betaUser),
  }
}

/**
 * Asserts that a query was refused *by a policy*, not by anything else.
 *
 * Drizzle wraps driver errors, so the RLS detail is on `cause`, not on
 * `message` — an assertion against the outer message passes for any failing
 * query at all, including a typo, which makes it worse than no assertion.
 *
 * Matched on SQLSTATE `42501` rather than on wording: the code is stable across
 * Postgres versions and locales, and this suite is the thing that must not
 * quietly stop testing what it claims to test.
 */
export async function expectPolicyRefusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause
    if (cause?.code === '42501') return cause.message ?? ''
    throw new Error(
      `Query failed, but not from a policy (SQLSTATE ${cause?.code}): ${cause?.message}`,
      // Keep the original: a failure here means the test's own SQL is wrong, and
      // the driver error is the only thing that says how.
      { cause: error },
    )
  }

  throw new Error('Query succeeded. A cross-property write must be refused.')
}

/** Truncates the public schema and removes every test auth user. */
export async function reset(): Promise<void> {
  assertLoopback()

  // `properties` cascades to everything property-scoped; profiles and members
  // go with their auth users.
  await db.execute(sql`truncate table properties restart identity cascade`)
  await db.execute(sql`truncate table domain_events restart identity cascade`)

  const users = await authFetch('/auth/v1/admin/users?per_page=200', { key: SERVICE_KEY })
  if (users.ok) {
    const { users: list } = (await users.json()) as { users: { id: string; email: string }[] }
    await Promise.all(
      list
        .filter((u) => u.email?.endsWith('@bookone.test'))
        .map((u) =>
          authFetch(`/auth/v1/admin/users/${u.id}`, { key: SERVICE_KEY, method: 'DELETE' }),
        ),
    )
  }
}
