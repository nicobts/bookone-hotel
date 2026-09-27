import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon } from 'lucide-react'
import { listPendingApprovals } from '@bookone/core/concierge'
import { PageShell } from '@/components/shell/page-shell'
import { requireFeature } from '@/lib/auth/current-property'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { Link } from '@/i18n/navigation'
import { approveAction, rejectAction } from './actions'

/**
 * Approvals (Guest Desk WP0.6) — what the concierge held for a person.
 *
 * The hard rules and the profiles' `approvalRequired` lists put every
 * money-shaped action here instead of running it (ADR-021). Nothing on this
 * page has happened yet; approving is what makes it happen, and the person who
 * approves is named on the run.
 */
export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { property } = await requireFeature(locale, slug, 'concierge')
  const pending = await listPendingApprovals(property.id)

  const t = await getTranslations('console.approvals')
  const context = { locale, slug }
  const when = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      {pending.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4 text-[color:var(--bo-success-500)]" aria-hidden />
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((item) => (
            <li
              key={`${item.runId}-${item.tool}`}
              className="bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">
                  {t.has(`tools.${item.tool}`) ? t(`tools.${item.tool}`) : item.tool}
                  {typeof item.input.time === 'string' && ` · ${item.input.time}`}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {item.guestName ?? '—'} · {when.format(item.at)}
                  {item.threadId && (
                    <>
                      {' · '}
                      <Link
                        href={`/${slug}/console/conversations/${item.threadId}`}
                        className="underline"
                      >
                        {t('openThread')}
                      </Link>
                    </>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <form action={rejectAction.bind(null, context)}>
                  <input type="hidden" name="runId" value={item.runId} />
                  <PendingButton variant="outline" size="sm">
                    {t('reject')}
                  </PendingButton>
                </form>
                <form action={approveAction.bind(null, context)}>
                  <input type="hidden" name="runId" value={item.runId} />
                  <PendingButton size="sm">{t('approve')}</PendingButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">{t('rejectNote')}</p>
    </PageShell>
  )
}
