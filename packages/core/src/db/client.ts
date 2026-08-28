import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * The raw connection.
 *
 * **Do not import this to serve a signed-in user.** It connects as a role that
 * bypasses RLS, so a plain `db.select()` returns every property's rows. Use
 * `withUser` from `./session` — the reasoning is in ADR-018 and it is not
 * optional.
 *
 * Exported at all because migrations, seeds, the sync engine, the nightly
 * reconciliation and the isolation tests genuinely need the unscoped handle.
 */

let client: postgres.Sql | undefined
let database: PostgresJsDatabase<typeof schema> | undefined

function connect(): PostgresJsDatabase<typeof schema> {
  if (database) return database

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env, then run `pnpm db:start`.')
  }

  // `prepare: false` because Supabase's pooler runs in transaction mode, where
  // prepared statements do not survive between checkouts. Harmless on a direct
  // connection and required on the pooled one, so it is set once here rather
  // than remembered per environment.
  client = postgres(url, { prepare: false })
  database = drizzle(client, { schema })
  return database
}

/**
 * Connected on first use rather than at import.
 *
 * The eager version reads better but means importing anything from this package
 * — the schema, a type — opens a socket or throws. Unit tests that touch no
 * database would then need a database, which is how a test suite acquires a
 * dependency nobody intended.
 *
 * "Fail loudly at startup" is still honoured where it matters: the worker
 * validates its environment at boot (`apps/worker/src/env.ts`) and does not wait
 * for a first query to discover a missing URL.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get: (_target, property) => Reflect.get(connect(), property),
})

/** For teardown in tests and for the worker's shutdown drain. */
export async function closeConnection(): Promise<void> {
  await client?.end({ timeout: 5 })
  client = undefined
  database = undefined
}

export type Database = PostgresJsDatabase<typeof schema>
