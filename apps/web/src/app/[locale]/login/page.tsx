import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { getCurrentUser } from '@/lib/auth/current-user'

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  // Someone already signed in has no business on the login page; send them to
  // the console, which resolves their property for them.
  if (await getCurrentUser()) {
    redirect(`/${locale}/console`)
  }

  const t = await getTranslations('auth.login')

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <LoginForm />
    </AuthShell>
  )
}
