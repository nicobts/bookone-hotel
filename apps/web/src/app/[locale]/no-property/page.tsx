import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthShell } from '@/components/auth/auth-shell'
import { LogoutButton } from '@/components/auth/logout-button'

/**
 * Someone signed in but attached to no property.
 *
 * Not an error and not a redirect loop: invited but not yet added, or added and
 * later removed. An empty console would imply their data had been lost, which
 * is a worse thing to tell a hotelier than the truth.
 */
export default async function NoPropertyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('noProperty')

  return (
    <AuthShell title={t('title')} subtitle={t('body')}>
      <LogoutButton label={t('signOut')} />
    </AuthShell>
  )
}
