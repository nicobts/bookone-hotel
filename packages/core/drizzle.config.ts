import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are written to the repo-root `supabase/migrations/`, not a
 * package-local folder. There is exactly one database behind both deployables
 * (ADR-003), so there is exactly one migration history — and it has to
 * interleave correctly with the hand-written RLS policy files the Supabase CLI
 * applies from that same folder, in filename order.
 *
 * Two settings below are load-bearing and neither is obvious:
 *
 *   `migrations.prefix: 'supabase'` — the Supabase CLI only applies files named
 *   `<14-digit timestamp>_name.sql`. Drizzle's default `0000_lucid_wolverine`
 *   naming is silently ignored: the file sits in the folder looking applied and
 *   never runs. There is no error to notice.
 *
 *   `DIRECT_DATABASE_URL` first — DDL through a transaction-mode pooler fails in
 *   ways that take an afternoon to diagnose. The pooled URL is deliberately last
 *   in the chain and only there so a misconfigured local still does something.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  migrations: { prefix: 'supabase' },
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
