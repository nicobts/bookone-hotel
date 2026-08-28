import createIntlMiddleware from 'next-intl/middleware'
import { createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'
import { isSupabaseConfigured, supabaseEnv } from '@/lib/supabase/env'
import {
  applyLifetime,
  isRemembered,
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE,
} from '@/lib/supabase/session-lifetime'

/**
 * Next 16 renamed Middleware to Proxy. Same single-file convention.
 *
 * Two jobs, in this order:
 *   1. next-intl resolves the locale and produces the response
 *   2. Supabase refreshes the auth session, writing its cookies onto that
 *      SAME response
 *
 * The ordering is load-bearing. Creating a second response instead of mutating
 * the first silently drops either the locale rewrite or the refreshed session
 * cookies — and it fails intermittently, only for users whose token happened to
 * be expiring, which is close to the worst possible failure signature.
 */
const handleI18n = createIntlMiddleware(routing)

export async function proxy(request: NextRequest) {
  const response = handleI18n(request)

  // The scaffold has to run before a Supabase project exists. Once .env is
  // filled in this branch is never taken again.
  if (!isSupabaseConfigured()) {
    return response
  }

  const supabase = createServerClient(supabaseEnv.url, supabaseEnv.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        // Every token refresh rewrites the auth cookies, so this is where a
        // session cookie would silently become a 30-day one. The lifetime is
        // decided by us, from the preference — see session-lifetime.ts.
        const remembered = isRemembered(request.cookies.getAll())

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, applyLifetime({ ...options }, remembered))
        }

        // Roll the preference forward alongside the session it governs.
        // Without this the marker expires on its own 30 days after login while
        // a rolling session is still valid, and somebody using the console
        // daily finds themselves quietly un-remembered.
        if (remembered) {
          response.cookies.set(REMEMBER_COOKIE, '1', {
            path: '/',
            sameSite: 'lax',
            maxAge: REMEMBER_MAX_AGE,
          })
        }

        // A response carrying a Set-Cookie for somebody's session must not be
        // cacheable, or a CDN can serve one user's token to another.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value)
        }
      },
    },
  })

  // Touching the user refreshes an expiring session. Do not remove: without a
  // call here, server components receive a stale token and log the user out
  // mid-shift.
  //
  // getUser(), never getSession(): getUser() revalidates the token against the
  // auth server, while getSession() trusts whatever is in the cookie. Only the
  // first is safe to gate access on.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && requiresSession(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/${localeOf(request.nextUrl.pathname)}/login`
    // Where they were heading, so login can send them back.
    url.searchParams.set('next', request.nextUrl.pathname)
    return Response.redirect(url) as never
  }

  return response
}

/**
 * BookOne has three surfaces and they authenticate three different ways, so
 * this check is three-way rather than the usual two.
 *
 *   public          `/`, `/login`, the legal pages — no session
 *   token-scoped    `/book/[property]` and `/stay/[token]` — no session ever.
 *                   Guests never hold a Supabase session (ADR-007); the stay
 *                   token is resolved server-side by the page itself.
 *   session-scoped  everything else, i.e. the console under `/[property]/…`
 *
 * The allowlist is of *public* paths rather than protected ones, because once
 * the property is a URL segment (ADR-016) application paths begin with
 * arbitrary text and "protected" stops being a set anyone can enumerate.
 *
 * The inversion is also the safer direction. A forgotten entry in a public
 * allowlist makes a public page ask for a login — annoying, and reported within
 * the hour. A forgotten entry in a protected list leaves a page open, and
 * nobody reports it.
 *
 * Still an optimistic check, not the security boundary. That is RLS in the
 * database, and every console page calls `requireProperty` for itself.
 */
const PUBLIC_SEGMENTS = ['', '/login', '/forgot-password', '/update-password', '/no-property']

/** Guest surfaces. Prefix matches, because both carry a dynamic segment. */
const GUEST_PREFIXES = ['/book/', '/stay/']

function requiresSession(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '').replace(/\/$/, '')

  if (PUBLIC_SEGMENTS.includes(withoutLocale)) return false
  if (GUEST_PREFIXES.some((prefix) => withoutLocale.startsWith(prefix))) return false

  return true
}

function localeOf(pathname: string): string {
  const maybeLocale = pathname.split('/')[1]

  return maybeLocale && routing.locales.includes(maybeLocale as (typeof routing.locales)[number])
    ? maybeLocale
    : routing.defaultLocale
}

export const config = {
  // Skip Next internals, the API surface, auth callbacks (which must not be
  // locale-rewritten — those links arrive from email), any file request, and
  // `/pay`.
  //
  // MEMO on `/pay`: it is the simulated checkout standing in for a payment
  // provider's hosted page (ADR-010). A provider's page has no locale of ours
  // and is reached by an id alone, so rewriting it to `/en/pay/...` would break
  // the one URL the adapter handed the guest. Deleted with the mock.
  matcher: ['/((?!api|auth|pay|_next|_vercel|.*[.].*).*)'],
}
