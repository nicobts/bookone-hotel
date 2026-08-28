'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { authErrorKey } from '@/lib/supabase/auth-errors'
import { useRouter } from '@/i18n/navigation'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { SubmitButton } from '@/components/auth/submit-button'

export function UpdatePasswordForm() {
  const t = useTranslations('auth.updatePassword')
  const tError = useTranslations('auth.error')
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)
  const [isNavigating, startNavigation] = React.useTransition()
  const pending = submitting || isNavigating

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isSupabaseConfigured()) {
      toast.error(tError('notConfigured'))
      return
    }

    const password = String(new FormData(event.currentTarget).get('password'))
    setSubmitting(true)

    const { error } = await createClient().auth.updateUser({ password })

    if (error) {
      toast.error(tError(authErrorKey(error)))
      setSubmitting(false)
      return
    }

    toast.success(t('done'))
    startNavigation(() => {
      router.replace('/console')
    })
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t('newPassword')}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>

      <SubmitButton pending={pending} pendingLabel={t('pending')} className="w-full">
        {t('submit')}
      </SubmitButton>
    </form>
  )
}
