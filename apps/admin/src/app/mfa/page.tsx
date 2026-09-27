import { redirect } from 'next/navigation'
import { createStaffClient } from '@/lib/supabase'
import { MfaForm } from './mfa-form'

export const metadata = { title: 'Two-factor' }

/**
 * MFA is mandatory in production (ADR-031). A staff account with a verified
 * TOTP factor is challenged; one without is enrolled first. Passkeys are the
 * stated preference and arrive when the staff project supports them.
 */
export default async function MfaPage() {
  const supabase = await createStaffClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase.auth.mfa.listFactors()
  const verified = data?.totp.find((factor) => factor.status === 'verified') ?? null

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-xl font-semibold">Two-factor authentication</h1>
        <p className="text-sm text-muted-foreground">
          {verified
            ? 'Enter the code from your authenticator app.'
            : 'The console requires an authenticator app. Set one up to continue.'}
        </p>
      </div>
      <MfaForm factorId={verified?.id ?? null} />
    </main>
  )
}
