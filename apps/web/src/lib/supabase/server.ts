import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseEnv } from './env'

/**
 * Supabase client for server components, route handlers and server actions.
 *
 * Auth only. Domain reads and writes go through `@bookone/core/db` with
 * `withUser` (ADR-018) — this client exists to answer "who is signed in", and
 * that answer becomes the identity the database enforces policies against.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server components cannot set cookies. Ignored deliberately: the
          // proxy refreshes the session on every request and writes the
          // cookies there, so nothing is lost by failing quietly here.
        }
      },
    },
  })
}
