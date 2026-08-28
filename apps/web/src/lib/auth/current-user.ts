import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The signed-in user, or null.
 *
 * `getUser()`, never `getSession()`: getUser revalidates the token against the
 * auth server, while getSession trusts whatever is in the cookie. Only the
 * first is safe to hand to `withUser`, because that id becomes the identity the
 * database enforces policies against — a forged cookie would otherwise choose
 * its own tenant.
 *
 * Memoised per request: the layout, the page and any action in the same render
 * all want the user, and `getUser()` is a network call to the auth server, not
 * a cookie read. The cache is request-scoped, so no identity survives into the
 * next request.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

/**
 * The signed-in user, or a redirect to login.
 *
 * The proxy already keeps signed-out visitors away from console routes, but
 * that is an optimistic check and it can be misconfigured. Pages call this so
 * the guarantee does not rest on the route matcher being correct.
 */
export async function requireUser(locale: string) {
  const user = await getCurrentUser()
  if (!user) {
    redirect(`/${locale}/login`)
  }
  return user
}
