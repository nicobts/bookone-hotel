'use client'

import { createBrowserClient } from '@supabase/ssr'
import { supabaseEnv } from './env'
import { REMEMBER_COOKIE, REMEMBER_MAX_AGE } from './session-lifetime'

/** Browser client. Used by the auth forms only — never for domain data. */
export function createClient() {
  return createBrowserClient(supabaseEnv.url, supabaseEnv.anonKey)
}

/**
 * Records the "remember me" choice as a cookie the proxy can read.
 *
 * Must be called BEFORE the sign-in call, never after: the auth cookies are
 * written during sign-in, and a preference recorded afterwards arrives too late
 * to affect the lifetime of the cookies it was meant to govern.
 */
export function setRememberPreference(remember: boolean): void {
  if (remember) {
    document.cookie = `${REMEMBER_COOKIE}=1; path=/; max-age=${REMEMBER_MAX_AGE}; samesite=lax`
    return
  }

  document.cookie = `${REMEMBER_COOKIE}=; path=/; max-age=0; samesite=lax`
}
