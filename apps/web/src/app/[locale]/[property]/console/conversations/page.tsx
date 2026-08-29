import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BotIcon, TriangleAlertIcon } from 'lucide-react'
import { listThreads } from '@bookone/core/db'
import { PageShell } from '@/components/shell/page-shell'
import { Link } from '@/i18n/navigation'
import { requireProperty } from '@/lib/auth/current-property'
import { Badge } from '@/components/ui/badge'

/**
 * The conversations queue (E3.2, E3.3).
 *
 * A work list, not a chat client. Every row answers one question — does this
 * need me — and the ordering answers it before the reader gets to the text:
 * unowned escalations, then anything else waiting on us, then the quiet ones,
 * and within each band the longest wait first.
 *
 * ## Sorted by waiting time, not by recency
 *
 * The obvious ordering is newest-first, and it is wrong here. It buries the
 * thread nobody has answered for two hours under three that arrived in the last
 * five minutes — and the buried one is the only one actually going wrong. The
 * decision is in the query so the console and any future digest agree about it.
 *
 * ## Unowned work is shown loudly
 *
 * A ten-room property has nobody whose job is to notice that nobody picked
 * something up. The reference inboxes solve this with assignment rules and
 * round-robin; we solve it by making "nobody has this" the first thing on the
 * screen, because routing rules a small hotel never configures route to nowhere.
 */
export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property } = await requireProperty(locale, slug)
  const threads = await listThreads(user.id, property.id)
  const t = await getTranslations('console.conversations')

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      {threads.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => {
            const waitingSince = thread.escalatedAt ?? thread.lastGuestMessageAt ?? null
            const unowned = thread.status === 'escalated' && !thread.assignedTo

            return (
              <li key={thread.id}>
                <Link
                  href={`/${slug}/console/conversations/${thread.id}`}
                  className="bg-card hover:border-ring/50 block rounded-lg border p-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-medium">
                        {thread.guestName ?? thread.reference}
                      </p>
                      {thread.preview && (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                          {thread.preview}
                        </p>
                      )}
                    </div>

                    {unowned ? (
                      // The one badge that is deliberately loud. Everything else
                      // on this screen is information; this is a claim that
                      // somebody has to act.
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <TriangleAlertIcon
                          className="size-3 text-[color:var(--bo-warning-500)]"
                          aria-hidden
                        />
                        {t('unassigned')}
                      </Badge>
                    ) : thread.assignedName ? (
                      <Badge variant="outline" className="shrink-0">
                        {thread.assignedName}
                      </Badge>
                    ) : thread.status === 'answered' ? (
                      <Badge variant="outline" className="shrink-0 gap-1">
                        <BotIcon className="size-3" aria-hidden />
                        {t('answered')}
                      </Badge>
                    ) : null}
                  </div>

                  <p className="text-muted-foreground mt-2 text-xs">
                    {waitingSince
                      ? t('waiting', { since: humanise(waitingSince, relative) })
                      : t('quiet')}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PageShell>
  )
}

/**
 * "23 minutes ago", in the reader's language.
 *
 * Relative rather than absolute because the only question this answers is *how
 * long has this been sitting*, and a timestamp makes a person do the subtraction
 * themselves at exactly the moment they are trying to triage a list.
 */
function humanise(at: Date, format: Intl.RelativeTimeFormat): string {
  const minutes = Math.round((at.getTime() - Date.now()) / 60_000)

  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute')

  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return format.format(hours, 'hour')

  return format.format(Math.round(hours / 24), 'day')
}
