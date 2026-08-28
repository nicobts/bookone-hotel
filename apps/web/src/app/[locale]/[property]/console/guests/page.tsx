import { getTranslations, setRequestLocale } from 'next-intl/server'
import { NotBuiltYet, PageShell } from '@/components/shell/page-shell'
import { requireProperty } from '@/lib/auth/current-property'

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)
  await requireProperty(locale, slug)

  const t = await getTranslations('nav')

  return (
    <PageShell locale={locale} title={t('guests')}>
      <NotBuiltYet
        sprint="Sprint 3"
        note="Guest records are written by the booking flow, not typed in."
      />
    </PageShell>
  )
}
