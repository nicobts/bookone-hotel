import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, ClockIcon } from 'lucide-react'
import { getToday } from '@bookone/core/db'
import { PageShell } from '@/components/shell/page-shell'
import { requireProperty } from '@/lib/auth/current-property'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { roomName } from '@/components/booking/format'

/**
 * Today — arrivals, departures, in-house (PRD C2).
 *
 * Live from Sprint 5, because the journey now has something to report. The
 * three counts are the shape of the day; the list underneath is the part
 * somebody acts on.
 *
 * ## The fourth number is the one that matters
 *
 * Arrivals, departures and in-house are information. **Awaiting guest** is a
 * count of people to chase, and it is the only figure on this screen that
 * implies work — so it is styled as a warning when it is not zero and reads as
 * nothing when it is. D15 says this console is not a dashboard: every number
 * here has to either be acted on or be reassuring, and a number that is neither
 * is decoration.
 */
export default async function TodayPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property } = await requireProperty(locale, slug)

  // The property's own calendar day, not the browser's. Arrival and departure
  // are hotel-local dates (03 §2), and a receptionist in Bolzano at 00:30
  // should still be looking at the day that is ending for them.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: property.timezone }).format(new Date())

  const view = await getToday(user.id, property.id, today)
  const t = await getTranslations('console.today')

  const panels = [
    { key: 'arrivals', label: t('arrivals'), value: view.arrivals.length, warn: false },
    { key: 'departures', label: t('departures'), value: view.departures, warn: false },
    { key: 'inHouse', label: t('inHouse'), value: view.inHouse, warn: false },
    {
      key: 'awaiting',
      label: t('awaiting'),
      value: view.awaitingGuest,
      warn: view.awaitingGuest > 0,
    },
  ] as const

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {panels.map((panel) => (
          <Card key={panel.key}>
            <CardHeader className="pb-2">
              <CardTitle className="bo-label">{panel.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Tabular by construction — these get compared down a column. */}
              <p
                className={
                  panel.warn
                    ? 'num text-3xl leading-none text-[color:var(--bo-warning-500)]'
                    : 'num text-3xl leading-none'
                }
              >
                {panel.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {view.arrivals.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noArrivals')}</p>
      ) : (
        <section>
          <h2 className="bo-label text-muted-foreground mb-3">{t('arrivalsHeading')}</h2>

          <ul className="flex flex-col gap-2">
            {view.arrivals.map((row) => (
              <li
                key={row.reservationId}
                className="bg-card flex items-center gap-4 rounded-lg border p-4"
              >
                {/* The time first: a desk reads this column top to bottom. */}
                <span className="num text-foreground w-14 shrink-0 text-sm">
                  {row.expectedArrivalTime ?? '—'}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {row.guestName ?? row.reference}
                  </p>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    <span className="num">{row.reference}</span>
                    {' · '}
                    {roomName(row.roomNameI18n, locale, row.roomCode)}
                    {' · '}
                    {t('guests', { adults: row.adults, children: row.children })}
                  </p>
                  {!row.expectedArrivalTime && (
                    <p className="text-muted-foreground mt-0.5 text-xs opacity-80">{t('noTime')}</p>
                  )}
                </div>

                {row.ready ? (
                  <Badge variant="secondary" className="shrink-0 gap-1">
                    <CheckCircle2Icon
                      className="size-3 text-[color:var(--bo-success-500)]"
                      aria-hidden
                    />
                    {t('ready')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 gap-1">
                    <ClockIcon className="size-3 text-[color:var(--bo-warning-500)]" aria-hidden />
                    {t('chase')}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  )
}
