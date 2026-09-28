import { configurationProblem, type StaffEnv } from './policy'

/**
 * The staff identity project (ADR-031): a different Supabase project from the
 * hotels' one in every deployed environment. Server-only names — nothing here
 * is `NEXT_PUBLIC_`, because the console has no browser-side Supabase client.
 */
export const staffEnv: StaffEnv = {
  url: process.env.ADMIN_SUPABASE_URL ?? '',
  anonKey: process.env.ADMIN_SUPABASE_ANON_KEY ?? '',
  tenantUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  production: process.env.NODE_ENV === 'production',
}

export const problem = configurationProblem(staffEnv)

/** Local development shares the one local Supabase with the hotels; the banner says so. */
export const sharedLocalProject =
  !staffEnv.production && Boolean(staffEnv.url) && staffEnv.url === staffEnv.tenantUrl

/**
 * The staff session's own cookie name, so a hotel session on the same host
 * (local development) can never be read as a staff one.
 */
export const STAFF_COOKIE = 'bo-staff'
