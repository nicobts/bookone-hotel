import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PageShell } from '@/components/shell/page-shell'
import { requireProperty } from '@/lib/auth/current-property'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Today — arrivals, departures, in-house (PRD C2).
 *
 * The shape of the day. Counts are hard-zero placeholders until reservations
 * carry journey state in Sprint 2; the layout is real so the numbers have
 * somewhere to land.
 */
export default async function TodayPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)
  await requireProperty(locale, slug)

  const t = await getTranslations('console.today')

  const panels = [
    { key: 'arrivals', label: t('arrivals') },
    { key: 'departures', label: t('departures') },
    { key: 'inHouse', label: t('inHouse') },
  ] as const

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      <div className="grid gap-4 sm:grid-cols-3">
        {panels.map((panel) => (
          <Card key={panel.key}>
            <CardHeader className="pb-2">
              <CardTitle className="bo-label">{panel.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Tabular by construction — these get compared down a column. */}
              <p className="num text-3xl leading-none">0</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">{t('empty')}</p>
    </PageShell>
  )
}
