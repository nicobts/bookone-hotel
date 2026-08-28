import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { db } from './client'
import type * as schema from './schema'

/**
 * Runs queries as a specific end user, with RLS actually enforced.
 *
 * WHY THIS EXISTS — the non-obvious part of the whole data layer:
 *
 * `DATABASE_URL` connects as a role holding `BYPASSRLS`. Every policy in the
 * database is therefore *invisible* to Drizzle: a plain
 * `db.select().from(reservations)` returns every property's rows, silently,
 * with no error and no failing test.
 *
 * That makes the client-path isolation tests misleading on their own. They prove
 * the policies work for a caller holding a user JWT — the path an attacker would
 * take — but not the path the application itself takes. Two access paths, and
 * only one of them was covered.
 *
 * So every read and write on behalf of a signed-in user goes through here. The
 * transaction installs the user's id as a JWT claim, which is what `auth.uid()`
 * reads and therefore what every policy resolves against, then drops to the
 * `authenticated` role, giving up the bypass. Inside the callback the database
 * enforces tenancy exactly as it does for any other client.
 *
 *   const arrivals = await withUser(userId, (tx) =>
 *     tx.select().from(schema.reservations),
 *   )
 *
 * `set local` scopes both settings to the transaction, so a pooled connection
 * cannot leak one user's identity into the next request. That specific failure
 * — request B inheriting request A's identity off a recycled connection — is
 * what this shape exists to make impossible.
 *
 * See ADR-018. Do not add a `where property_id = …` and call it a substitute:
 * that is scoping, not isolation, and one omission is a breach with no error.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Claims first, then the role. Once the role is dropped the connection is no
    // longer privileged, so it could not set the claim afterwards — the ordering
    // is a requirement, not a style choice.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: userId,
        role: 'authenticated',
      })}, true)`,
    )
    await tx.execute(sql`select set_config('role', 'authenticated', true)`)

    return fn(tx as unknown as PostgresJsDatabase<typeof schema>)
  })
}

/**
 * Runs queries with RLS bypassed.
 *
 * The escape hatch, named to be conspicuous in review: every call is a claim
 * that the work genuinely spans properties. Legitimate callers are the sync
 * engine, the nightly reconciliation, invitations, and seeds.
 *
 * Binding rule 3 still applies inside it — **service-role is not permission to
 * write an unscoped query.** A cross-property job scopes each statement to the
 * property it is currently working on, explicitly. If something reaches for this
 * because `withUser` "returned nothing", the bug is the membership.
 */
export function asService<T>(fn: (database: typeof db) => Promise<T>): Promise<T> {
  return fn(db)
}

/**
 * Guest surfaces do not appear here on purpose.
 *
 * Guests never hold a database session (ADR-007). `/[locale]/stay/[token]`
 * resolves a short-lived signed token server-side and queries on the guest's
 * behalf, scoped to one reservation. That resolver is the boundary and gets
 * tested as such — it is not a role, so it needs no wrapper here. It lands in
 * Sprint 5.
 */
