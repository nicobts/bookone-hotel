import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, InfoIcon, LockIcon } from 'lucide-react'
import { buildReport, listReportPeriods, periodOf, type ReportSection } from '@bookone/core/billing'
import { PageShell } from '@/components/shell/page-shell'
import { Link } from '@/i18n/navigation'
import { requireOwner } from '@/lib/auth/current-property'
import { formatDate, formatMoney } from '@/components/booking/format'
import { ExportButton } from '@/components/report/export-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { dispute, exportCsv, issue } from './actions'

/**
 * The monthly revenue and fee report (E5.4, PRD C4).
 *
 * **This is the invoice basis**, and the person reading it signed a
 * percentage-of-revenue deal with a young company. They will read it
 * adversarially, and every decision on this screen assumes so.
 *
 * ## Three things it does that a summary would not
 *
 * **Shows the arithmetic.** Count, basis, rate, fee — on every section, so the
 * total can be checked rather than accepted.
 *
 * **Drills to the evidence.** An AI-attributed line carries the chain that
 * produced it: which session, when it started, and what engine touches were in
 * the window including the ones that did not disqualify it. Omitting the
 * inconvenient number is how an evidence chain stops being believed.
 *
 * **Puts the dispute on the line itself.** Not behind a support address. D14
 * resolves disputes in the owner's favour and the credit is applied on the
 * spot, so the button is where the disagreement is.
 *
 * Nothing here is fiscal (D11, binding rule 6): no tax is computed, no document
 * is issued, and nothing is transmitted to any authority.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; property: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property } = await requireOwner(locale, slug)
  void user

  const query = await searchParams
  const t = await getTranslations('console.report')

  const periods = await listReportPeriods(property.id)
  const requested = typeof query.period === 'string' ? query.period : null

  /*
   * Defaults to *last* month, not this one.
   *
   * A statement for a month still in progress is a number that changes every
   * time it is opened, which is exactly the impression this screen cannot
   * afford to give. The current month is reachable from the selector and
   * labelled a draft.
   */
  const now = new Date()
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0))
  const periodStart = requested ?? periodOf(lastMonth, 'Europe/Rome')

  const report = await buildReport({ propertyId: property.id, periodStart })
  const context = { locale, slug, periodStart }

  if (!report) {
    return (
      <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      </PageShell>
    )
  }

  const issued = report.status === 'issued'
  const month = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${periodStart}T12:00:00Z`))

  return (
    <PageShell
      locale={locale}
      title={t('title')}
      subtitle={month}
      actions={
        <div className="flex items-center gap-2">
          <ExportButton
            action={exportCsv.bind(null, context)}
            label={t('export.action')}
            busyLabel={t('export.busy')}
            errorLabel={t('export.failed')}
          />
          {issued ? (
            <Badge variant="secondary" className="gap-1">
              <LockIcon className="size-3" aria-hidden />
              {t('issued')}
            </Badge>
          ) : (
            <form action={issue.bind(null, context)}>
              <Button type="submit" size="sm">
                {t('issue')}
              </Button>
            </form>
          )}
        </div>
      }
    >
      {/* ------------------------------------------------------ the headline */}
      <section className="bg-card rounded-lg border p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="bo-label text-muted-foreground">{t('total')}</p>
            <p className="num text-foreground mt-1 text-3xl font-semibold">
              {formatMoney(report.totalCents, report.currency, locale)}
            </p>
          </div>

          {report.perRoomCents !== null && (
            <div className="text-right">
              <p className="bo-label text-muted-foreground">{t('perRoomLabel')}</p>
              <p className="num text-foreground mt-1 text-xl font-semibold">
                {t('perRoom', {
                  amount: formatMoney(report.perRoomCents, report.currency, locale),
                  rooms: report.rooms ?? 0,
                })}
              </p>
            </div>
          )}
        </div>

        {/*
          The equivalence includes the percentage fees, and says so (ADR-015,
          D20). A €/room/month figure showing only the base would flatter us by
          omitting the part that varies — on the one line built to be compared
          against a competitor's published price.
        */}
        {report.perRoomCents !== null && (
          <p className="text-muted-foreground mt-3 text-xs">{t('perRoomNote')}</p>
        )}

        {issued && report.issuedAt && (
          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
            <LockIcon className="size-3" aria-hidden />
            {t('issuedAt', { at: formatDate(report.issuedAt.slice(0, 10), locale) })}
          </p>
        )}
      </section>

      {report.sections.map((section) => (
        <Section
          key={section.kind}
          section={section}
          report={report}
          locale={locale}
          context={context}
          issued={issued}
        />
      ))}

      <Separator />

      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('notFiscal')}
      </p>

      {periods.length > 0 && (
        <section>
          <h2 className="bo-label text-muted-foreground mb-3">{t('periods')}</h2>
          <ul className="flex flex-wrap gap-2">
            {periods.map((period) => (
              <li key={period.periodStart}>
                <Link
                  href={`/${slug}/console/report?period=${period.periodStart}`}
                  className="bg-card hover:border-ring/50 num inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors"
                >
                  {period.periodStart.slice(0, 7)}
                  {period.status === 'issued' && <LockIcon className="size-3" aria-hidden />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  )
}

async function Section({
  section,
  report,
  locale,
  context,
  issued,
}: {
  section: ReportSection
  report: { currency: string }
  locale: string
  context: { locale: string; slug: string; periodStart: string }
  issued: boolean
}) {
  const t = await getTranslations('console.report')

  const label =
    section.kind === 'subscription'
      ? t('sections.subscription')
      : section.kind === 'direct_booking'
        ? t('sections.direct')
        : t('sections.attributed')

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-foreground font-medium">{label}</h2>
        <p className="num text-foreground font-semibold">
          {formatMoney(section.netCents, report.currency, locale)}
        </p>
      </div>

      {/* The arithmetic, so the total can be checked rather than accepted. */}
      {section.rateBps !== null && (
        <p className="text-muted-foreground mb-3 text-xs">
          {t('sectionMath', {
            count: section.count,
            basis: formatMoney(section.basisCents ?? 0, report.currency, locale),
            rate: (section.rateBps / 100).toFixed(2),
            gross: formatMoney(section.grossCents, report.currency, locale),
          })}
        </p>
      )}

      {section.items.length === 0 ? (
        /*
          Zero is shown, not hidden (design note §4G).

          An owner who never sees the AI-attributed line cannot form a view
          about whether the rate is fair — and the first month it appears, it
          looks like something new was introduced.
        */
        <p className="text-muted-foreground text-sm">{t('sectionEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {section.items.map((item) => (
            <li key={item.feeEventId} className="bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium">
                    {item.guestName ?? item.reference}
                  </p>
                  <p className="text-muted-foreground num mt-0.5 text-xs">
                    {item.reference} · {formatDate(item.arrivalDate, locale)} →{' '}
                    {formatDate(item.departureDate, locale)}
                  </p>
                </div>

                <div className="text-right">
                  <p
                    className={`num text-sm font-medium ${item.creditCents > 0 ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {formatMoney(item.feeCents, report.currency, locale)}
                  </p>
                  <p className="text-muted-foreground num mt-0.5 text-xs">
                    {t('ofBasis', {
                      basis: formatMoney(item.basisCents, report.currency, locale),
                      rate: (item.rateBps / 100).toFixed(2),
                    })}
                  </p>
                </div>
              </div>

              {/* The evidence chain, on the line it justifies. */}
              {section.kind === 'ai_attributed' && (
                <details className="mt-3">
                  <summary className="text-muted-foreground cursor-pointer text-xs">
                    {t('evidence.show')}
                  </summary>
                  <dl className="text-muted-foreground mt-2 grid gap-1 text-xs">
                    <Evidence label={t('evidence.reason')} value={item.evidence.reason} />
                    <Evidence
                      label={t('evidence.session')}
                      value={item.evidence.conciergeSessionId}
                    />
                    <Evidence
                      label={t('evidence.startedAt')}
                      value={item.evidence.conciergeStartedAt}
                    />
                    <Evidence
                      label={t('evidence.engineTouches')}
                      value={item.evidence.engineTouchesInWindow}
                    />
                    <Evidence label={t('evidence.window')} value={item.evidence.windowStart} />
                  </dl>
                </details>
              )}

              {item.creditCents > 0 ? (
                <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
                  <CheckCircle2Icon
                    className="size-3.5 text-[color:var(--bo-success-500)]"
                    aria-hidden
                  />
                  {t('credited', {
                    amount: formatMoney(item.creditCents, report.currency, locale),
                  })}
                </p>
              ) : (
                !issued && (
                  <form
                    action={dispute.bind(null, { ...context, feeEventId: item.feeEventId })}
                    className="mt-3"
                  >
                    <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      {t('disputeAction')}
                    </Button>
                  </form>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Evidence({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return null

  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="num text-foreground text-right">{String(value)}</dd>
    </div>
  )
}
