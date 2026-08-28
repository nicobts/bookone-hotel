'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { createClient, setRememberPreference } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { authErrorKey } from '@/lib/supabase/auth-errors'
import { Link, useRouter } from '@/i18n/navigation'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { SubmitButton } from '@/components/auth/submit-button'

export function LoginForm() {
  const t = useTranslations('auth.login')
  const tAuth = useTranslations('auth')
  const tError = useTranslations('auth.error')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [submitting, setSubmitting] = React.useState(false)

  /**
   * The half of "busy" that outlasts the network call.
   *
   * `router.push` schedules a navigation and returns; it does not wait for it.
   * Signing in has two phases — the credentials call, then a fetch of the
   * destination, which resolves the property and queries the database — and
   * only the first is covered by an `await`. A transition holds `isNavigating`
   * true across the second, which is the part the person was otherwise
   * watching a dead button through.
   */
  const [isNavigating, startNavigation] = React.useTransition()
  const pending = submitting || isNavigating

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isSupabaseConfigured()) {
      toast.error(tError('notConfigured'))
      return
    }

    const form = new FormData(event.currentTarget)
    setSubmitting(true)

    try {
      // Before the sign-in, never after: the auth cookies are written during
      // the call below, and a preference recorded afterwards arrives too late
      // to govern them.
      setRememberPreference(form.get('remember') !== null)

      const { error } = await createClient().auth.signInWithPassword({
        email: String(form.get('email')),
        password: String(form.get('password')),
      })

      if (error) {
        toast.error(tError(authErrorKey(error)))
        setSubmitting(false)
        return
      }

      // `next` is set by the proxy when it bounces a signed-out person off a
      // console route. Only same-origin relative paths are honoured — an
      // absolute URL here would be an open redirect.
      const next = searchParams.get('next')
      const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/console'

      startNavigation(() => {
        router.replace(destination)
      })
    } catch {
      toast.error(tError('unknown'))
      setSubmitting(false)
    }
  }

  return (
    // method="post" is not decoration. If this component fails to hydrate —
    // a blocked chunk, a flaky network, a CSP mistake — the browser falls back
    // to a native submit. With the default GET that puts the password in the
    // URL, the browser history and every access log between here and the
    // server. POST keeps it in the body of a request that goes nowhere.
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

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">{tAuth('password')}</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            {t('forgot')}
          </Link>
        </div>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox id="remember" name="remember" className="mt-0.5" />
        <div className="grid gap-1">
          <Label htmlFor="remember" className="text-sm font-normal">
            {t('remember')}
          </Label>
          <p className="text-muted-foreground text-xs">{t('rememberHint')}</p>
        </div>
      </div>

      <SubmitButton pending={pending} pendingLabel={t('pending')} className="w-full">
        {t('submit')}
      </SubmitButton>
    </form>
  )
}
