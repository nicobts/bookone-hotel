import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, DownloadIcon } from 'lucide-react'
import { authorityOf, complianceToday, type AuthorityToday } from '@bookone/core/compliance'
import { PageShell } from '@/components/shell/page-shell'
import { requireCompliance } from '@/lib/compliance/access'
import { Badge } from '@bookone/ui/components/badge'
import { Button } from '@bookone/ui/components/button'
import { Input } from '@bookone/ui/components/input'
import { Label } from '@bookone/ui/components/label'

/**
 * The property's filings with the authorities (Guest Desk WP1.6).
 *
 * Today first, per authority: what is late, what is due before the day ends,
 * what is with the authority and what needs a person. Then every filing still
 * open, soonest deadline first, each opening its own screen. Then the archive:
 * a period's export, for an inspection.
 *
 * Read as the member (RLS), and only for the modules the property has
 * (`requireCompliance`). The design note is `docs/design-notes/compliance-dashboard.md`.
 */
export default async function CompliancePage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property, adapterIds } = await requireCompliance(locale, slug)
  const today = await complianceToday(user.id, property.id, {
    adapterIds,
    timeZone: property.timezone,
  })

  const t = await getTranslations('console.compliance')
  const format = await getFormatter()
  const now = new Date()
  const base = `/${locale}/${slug}/console/compliance`

  // The export's default period: this month, in the property's days.
  const month = today.date.slice(0, 7)
  const monthStart = `${month}-01`

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      <section aria-labelledby="compliance-today" className="flex flex-col gap-3">
        <h2 id="compliance-today" className="text-sm font-medium">
          {t('today', {
            date: format.dateTime(now, { timeZone: property.timezone, dateStyle: 'full' }),
          })}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {adapterIds.map((adapterId) => {
            const counts =
              today.authorities.find((entry) => entry.adapterId === adapterId) ??
              emptyCounts(adapterId)
            return <AuthorityCard key={adapterId} counts={counts} t={t} />
          })}
        </div>
      </section>

      <section aria-labelledby="compliance-open" className="flex flex-col gap-3">
        <h2 id="compliance-open" className="text-sm font-medium">
          {t('openTitle')}
        </h2>
        {today.open.length === 0 ? (
          <div className="border-border flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <CheckCircle2Icon className="size-5 text-[color:var(--bo-success-500)]" aria-hidden />
            <p className="text-muted-foreground text-sm">{t('openEmpty')}</p>
          </div>
        ) : (
          <ul className="divide-border bg-card flex flex-col divide-y rounded-lg border">
            {today.open.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {authorityName(t, row.authority)}
                    <span className="text-muted-foreground num ml-2 font-normal">
                      {row.reference ?? row.periodDate ?? t('noSubject')}
                    </span>
                  </p>
                  <p
                    className={`mt-0.5 text-xs ${row.overdue ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {t(row.overdue ? 'overdueSince' : 'dueBy', {
                      deadline: format.dateTime(row.deadline, {
                        timeZone: property.timezone,
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      relative: format.relativeTime(row.deadline, now),
                    })}
                  </p>
                </div>
                <Badge variant={row.state === 'manual' || row.overdue ? 'destructive' : 'outline'}>
                  {t(`states.${row.state}`)}
                </Badge>
                <Button asChild size="sm" variant="outline">
                  <a href={`${base}/${row.id}`}>{t('open')}</a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="compliance-archive" className="flex flex-col gap-3">
        <div>
          <h2 id="compliance-archive" className="text-sm font-medium">
            {t('archiveTitle')}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-prose text-xs">{t('archiveHint')}</p>
        </div>
        {/* A plain GET form: the export is a file, and its period is in the URL. */}
        <form
          action={`${base}/export`}
          method="get"
          className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export-from">{t('from')}</Label>
            <Input id="export-from" name="from" type="date" defaultValue={monthStart} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export-to">{t('to')}</Label>
            <Input id="export-to" name="to" type="date" defaultValue={today.date} required />
          </div>
          <Button type="submit" size="sm" variant="outline">
            <DownloadIcon className="size-4" aria-hidden />
            {t('export')}
          </Button>
        </form>
      </section>
    </PageShell>
  )
}

type T = Awaited<ReturnType<typeof getTranslations<'console.compliance'>>>

function authorityName(t: T, authority: string): string {
  return t.has(`authorities.${authority}`) ? t(`authorities.${authority}`) : authority
}

function emptyCounts(adapterId: string): AuthorityToday {
  return {
    adapterId,
    authority: authorityOf(adapterId) ?? adapterId,
    dueToday: 0,
    overdue: 0,
    submitted: 0,
    failed: 0,
    acknowledgedToday: 0,
  }
}

/** One authority's day: late first, because late is a different conversation. */
function AuthorityCard({ counts, t }: { counts: AuthorityToday; t: T }) {
  const figures: [key: string, value: number, loud: boolean][] = [
    ['overdue', counts.overdue, counts.overdue > 0],
    ['dueToday', counts.dueToday, false],
    ['failed', counts.failed, counts.failed > 0],
    ['submitted', counts.submitted, false],
    ['acknowledgedToday', counts.acknowledgedToday, false],
  ]
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-sm font-medium">{authorityName(t, counts.authority)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {figures.map(([key, value, loud]) => (
          <div key={key} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground text-xs">{t(`counts.${key}`)}</dt>
            <dd className={`num text-sm font-medium ${loud ? 'text-destructive' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
