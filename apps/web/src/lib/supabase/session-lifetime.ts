import type { CookieOptions } from '@supabase/ssr'

/**
 * How long a session cookie lives.
 *
 * Every token refresh rewrites the auth cookies, which is exactly where a
 * session cookie silently becomes a long-lived one. The lifetime is decided
 * here, from the person's own "remember me" choice, and applied on every write.
 *
 * Without "remember me" the cookie is a session cookie — gone when the browser
 * closes. That is the right default on a hotel's front-desk machine, which is
 * shared by every seasonal receptionist on the rota.
 */
export const REMEMBER_COOKIE = 'bo-remember'

/** 30 days, rolled forward on each refresh while the session stays alive. */
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30

export function isRemembered(cookies: { name: string; value: string }[]): boolean {
  return cookies.some((cookie) => cookie.name === REMEMBER_COOKIE && cookie.value === '1')
}

export function applyLifetime(options: CookieOptions, remembered: boolean): CookieOptions {
  if (remembered) {
    return { ...options, maxAge: REMEMBER_MAX_AGE }
  }

  // Strip both: `expires` and `maxAge` each independently turn this into a
  // persistent cookie, and Supabase sets one of them by default.
  const { maxAge: _maxAge, expires: _expires, ...session } = options
  return session
}
