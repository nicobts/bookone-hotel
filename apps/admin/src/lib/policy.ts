import type { StaffRole } from '@bookone/core/admin'

/**
 * The operator console's access rules (ADR-031), as pure functions so they are
 * tested rather than trusted. Everything that decides "may this person in" and
 * "may this configuration boot" is here; the Supabase calls around it only
 * gather the inputs.
 */

export interface StaffEnv {
  url: string
  anonKey: string
  /** The tenant project, which the staff project must never be in production. */
  tenantUrl: string
  production: boolean
}

/**
 * Why this configuration must not serve, or null when it may.
 *
 * Refusing to serve is the point: a console signed in against the hotel-user
 * store would make every tenant session a candidate operator session, which is
 * the exact thing the separate project exists to prevent (ADR-031, first
 * rejected alternative). Local development shares the one local Supabase, and
 * the console says so on screen.
 */
export function configurationProblem(env: StaffEnv): string | null {
  if (!env.url || !env.anonKey) return 'ADMIN_SUPABASE_URL and ADMIN_SUPABASE_ANON_KEY are not set'
  if (env.production && sameOrigin(env.url, env.tenantUrl)) {
    return 'the staff identity project is the tenant project; production refuses this (ADR-031)'
  }
  if (env.production && !env.url.startsWith('https://')) {
    return 'the staff identity project must be reached over https in production'
  }
  return null
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return a === b
  }
}

/**
 * The role a staff account holds, from `app_metadata`.
 *
 * `app_metadata` and not `user_metadata`: the second is writable by the user
 * themselves through the Auth API, and a role a person can grant themselves is
 * not a role. No recognised value means no access at all — not "support".
 */
export function staffRoleOf(appMetadata: unknown): StaffRole | null {
  if (typeof appMetadata !== 'object' || appMetadata === null) return null
  const role = (appMetadata as Record<string, unknown>).staff_role
  return role === 'admin' || role === 'support' ? role : null
}

export type Admission =
  { status: 'admitted'; role: StaffRole } | { status: 'no-role' } | { status: 'mfa-required' }

/**
 * Whether a signed-in account may use the console.
 *
 * MFA (`aal2`) is mandatory in production (ADR-031). Locally it is optional so
 * the console can be exercised without an authenticator app; the banner says so.
 */
export function admit(input: {
  appMetadata: unknown
  aal: string | null
  production: boolean
}): Admission {
  const role = staffRoleOf(input.appMetadata)
  if (!role) return { status: 'no-role' }
  if (input.production && input.aal !== 'aal2') return { status: 'mfa-required' }
  return { status: 'admitted', role }
}

/** The first address in `x-forwarded-for`, which the Tailscale proxy sets. */
export function clientIp(forwardedFor: string | null, realIp: string | null): string | null {
  const first = forwardedFor?.split(',')[0]?.trim()
  return first || realIp?.trim() || null
}
