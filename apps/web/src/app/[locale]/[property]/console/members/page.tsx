import { getTranslations, setRequestLocale } from 'next-intl/server'
import { NotBuiltYet, PageShell } from '@/components/shell/page-shell'
import { requireOwner } from '@/lib/auth/current-property'

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)
  await requireOwner(locale, slug)

  const t = await getTranslations('nav')

  return (
    <PageShell locale={locale} title={t('members')}>
      <NotBuiltYet sprint="Sprint 9" note="Invite staff and set roles. Owner-only." />
    </PageShell>
  )
}
