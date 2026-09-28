import 'server-only'
import type { StaffActor } from '@bookone/core/admin'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { problem, staffEnv } from './env'
import { admit, clientIp } from './policy'
import { createStaffClient } from './supabase'

/**
 * The signed-in operator, or a redirect. Every page and every server action
 * calls this first — it is the "staff authentication, then a role check" of
 * ADR-031; the audit half is `withAdminAudit` in core.
 *
 * `getUser()`, not `getSession()`: it asks the Auth server rather than trusting
 * the cookie's contents, which a client can forge.
 */
export async function requireStaff(): Promise<StaffActor> {
  if (problem) throw new Error(`Admin console misconfigured: ${problem}`)

  const supabase = await createStaffClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const admission = admit({
    appMetadata: user.app_metadata,
    aal: aal?.currentLevel ?? null,
    production: staffEnv.production,
  })

  if (admission.status === 'no-role') redirect('/login?error=no-role')
  if (admission.status === 'mfa-required') redirect('/mfa')

  const h = await headers()
  return {
    id: user.id,
    email: user.email ?? null,
    role: admission.role,
    ip: clientIp(h.get('x-forwarded-for'), h.get('x-real-ip')),
  }
}

/** Mutations: admins only. Support staff read (ADR-031, read-only by default). */
export async function requireAdmin(): Promise<StaffActor> {
  const staff = await requireStaff()
  if (staff.role !== 'admin') throw new Error('Only an admin can change a property.')
  return staff
}
