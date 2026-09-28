import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { STAFF_COOKIE, problem, staffEnv } from '@/lib/env'

/**
 * Refreshes the staff session on every request and writes the cookies onto the
 * response (the pattern `apps/web` uses). It decides nothing about access:
 * pages and actions call `requireStaff`, which asks the Auth server.
 */
export async function proxy(request: NextRequest) {
  // Misconfigured — above all, staff pointed at the tenant project in
  // production — means nothing is served: not a login form, not a page.
  if (problem) {
    return new NextResponse(`Admin console misconfigured: ${problem}`, {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const response = NextResponse.next({ request })

  const supabase = createServerClient(staffEnv.url, staffEnv.anonKey, {
    cookieOptions: { name: STAFF_COOKIE, sameSite: 'strict', secure: staffEnv.production },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
