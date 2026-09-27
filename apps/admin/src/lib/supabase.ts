import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { STAFF_COOKIE, staffEnv } from './env'

/** Staff-project auth client. Auth only: domain access goes through `@bookone/core/admin`. */
export async function createStaffClient() {
  const cookieStore = await cookies()

  return createServerClient(staffEnv.url, staffEnv.anonKey, {
    cookieOptions: { name: STAFF_COOKIE, sameSite: 'strict', secure: staffEnv.production },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server components cannot set cookies; the proxy refreshes them.
        }
      },
    },
  })
}
