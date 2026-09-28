'use server'

import { redirect } from 'next/navigation'
import { staffRoleOf } from '@/lib/policy'
import { createStaffClient } from '@/lib/supabase'

export interface AuthState {
  error: string | null
}

/**
 * Password sign-in against the staff project. The error is deliberately
 * generic: which half was wrong is information for an attacker, not an operator.
 */
export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createStaffClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
  })
  if (error) return { error: 'Sign-in failed.' }

  // A valid account without a staff role gets no session at all, rather than
  // a signed-in session every page then refuses.
  if (!staffRoleOf(data.user?.app_metadata)) {
    await supabase.auth.signOut()
    return { error: 'This account has no staff role.' }
  }
  redirect('/')
}

export async function signOut(): Promise<void> {
  const supabase = await createStaffClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export interface EnrolState {
  factorId: string | null
  qr: string | null
  error: string | null
}

/** Starts TOTP enrolment; the QR is shown once and never stored by us. */
export async function enrolTotp(): Promise<EnrolState> {
  const supabase = await createStaffClient()
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `ops-${Date.now()}`,
  })
  if (error || !data) return { factorId: null, qr: null, error: 'Could not start enrolment.' }
  return { factorId: data.id, qr: data.totp.qr_code, error: null }
}

/** Verifies a TOTP code for a factor, lifting the session to aal2. */
export async function verifyTotp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createStaffClient()
  const factorId = String(form.get('factorId') ?? '')
  const code = String(form.get('code') ?? '').replace(/\s+/g, '')

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  })
  if (challengeError || !challenge) return { error: 'Could not start the challenge.' }

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  })
  if (error) return { error: 'That code was not accepted.' }
  redirect('/')
}
