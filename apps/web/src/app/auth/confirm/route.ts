import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { routing } from '@/i18n/routing'

/**
 * Email link callback — password resets and invitations land here.
 *
 * Deliberately outside `/[locale]/`: the proxy's matcher skips `/auth`, so this
 * path is never locale-rewritten. Links arrive from an email client days after
 * they were sent, and a rewrite in the middle of a token exchange loses the
 * token. The locale travels as `next` instead and is validated below.
 *
 * `verifyOtp` consumes a single-use token and establishes the session; the
 * cookies are written through the server client on the redirect response.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next')

  const destination = safeDestination(next)

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL(`${destination.locale}/login?error=link`, request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    return NextResponse.redirect(new URL(`${destination.locale}/login?error=link`, request.url))
  }

  return NextResponse.redirect(new URL(destination.path, request.url))
}

/**
 * `next` comes from a URL a person clicked, so it is untrusted input.
 *
 * Only same-origin relative paths are honoured — an absolute URL would make
 * this an open redirect, and an open redirect on an endpoint that has just
 * established a session is worth more to an attacker than most.
 */
function safeDestination(next: string | null): { path: string; locale: string } {
  const fallbackLocale = `/${routing.defaultLocale}`

  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return { path: `${fallbackLocale}/console`, locale: fallbackLocale }
  }

  const [, maybeLocale] = next.split('/')
  const locale = routing.locales.includes(maybeLocale as (typeof routing.locales)[number])
    ? `/${maybeLocale}`
    : fallbackLocale

  return { path: next, locale }
}
