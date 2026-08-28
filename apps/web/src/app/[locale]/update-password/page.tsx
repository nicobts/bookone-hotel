import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthShell } from '@/components/auth/auth-shell'
import { UpdatePasswordForm } from '@/components/auth/update-password-form'

export default async function UpdatePasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth.updatePassword')

  return (
    <AuthShell title={t('title')} subtitle={t('subtitle')}>
      <UpdatePasswordForm />
    </AuthShell>
  )
}
