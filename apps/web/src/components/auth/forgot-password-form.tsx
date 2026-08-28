'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { authErrorKey } from '@/lib/supabase/auth-errors'
import { Link } from '@/i18n/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubmitButton } from '@/components/auth/submit-button'

export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword')
  const tAuth = useTranslations('auth')
  const tError = useTranslations('auth.error')
  const locale = useLocale()
  const [pending, setPending] = React.useState(false)
  const [sent, setSent] = React.useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isSupabaseConfigured()) {
      toast.error(tError('notConfigured'))
      return
    }

    const email = String(new FormData(event.currentTarget).get('email'))
    setPending(true)

    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      // The callback is outside the locale segment (the proxy skips /auth), so
      // the locale travels as a query parameter and the handler restores it.
      redirectTo: `${window.location.origin}/auth/confirm?next=/${locale}/update-password`,
    })

    setPending(false)

    if (error) {
      toast.error(tError(authErrorKey(error)))
      return
    }

    // Shown whether or not the address exists. Saying "no such account" here
    // turns this form into an account-enumeration oracle.
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{t('sent')}</p>
        <Link href="/login" className="text-primary text-sm hover:underline">
          {t('back')}
        </Link>
      </div>
    )
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{tAuth('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder={tAuth('emailPlaceholder')}
        />
      </div>

      <SubmitButton pending={pending} pendingLabel={t('pending')} className="w-full">
        {t('submit')}
      </SubmitButton>

      <Link
        href="/login"
        className="text-muted-foreground hover:text-foreground text-center text-sm transition-colors"
      >
        {t('back')}
      </Link>
    </form>
  )
}
