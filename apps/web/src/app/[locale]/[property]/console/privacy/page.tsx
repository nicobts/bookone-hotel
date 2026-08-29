import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AlertTriangleIcon, DownloadIcon, SearchIcon, ShieldIcon } from 'lucide-react'
import {
  declaredPeriods,
  findSubjects,
  getSubject,
  listRequests,
  DATA_MAP,
} from '@bookone/core/privacy'
import { PageShell } from '@/components/shell/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { requireOwner } from '@/lib/auth/current-property'
import { Link } from '@/i18n/navigation'
import { applyErasure, requestExport } from './actions'

/**
 * The data-subject request desk (E8.1).
 *
 * ## The controller is the hotel; we are the processor
 *
 * The single fact that shapes this whole surface. A guest exercises their
 * rights against the property, not against us — so the desk lives in the
 * property's console, the property's owner presses the button, and we supply
 * the machinery and the audit trail rather than a decision about their guest.
 * There is deliberately no guest-facing erasure button anywhere in the product
 * (design-notes/privacy.md §4G).
 *
 * ## Erasure is two steps and says what it cannot do
 *
 * Searching finds a person; erasing them takes a second screen that lists the
 * carve-outs first. A reservation is fiscal-adjacent and an Alloggiati filing
 * is a filing with a public authority — Art. 17(3)(b) — and the owner is told
 * that *before* the button rather than in a footnote afterwards.
 *
 * ## The search returns nothing until you type
 *
 * Not laziness. A screen that renders every guest's contact details by default
 * is a screen that leaks them to whoever is standing behind the desk.
 */
export default async function PrivacyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; property: string }>
  searchParams: Promise<{ q?: string; erase?: string; erased?: string; error?: string }>
}) {
  const { locale, property: slug } = await params
  const query = await searchParams
  setRequestLocale(locale)

  const { property } = await requireOwner(locale, slug)
  const t = await getTranslations('console.privacy')

  const [requests, matches, pending] = await Promise.all([
    listRequests(property.id),
    findSubjects(property.id, query.q ?? ''),
    query.erase ? getSubject(property.id, query.erase) : Promise.resolve(null),
  ])

  const open = requests.filter((request) => request.status === 'open')
  const overdue = open.filter((request) => request.dueBy.getTime() < Date.now())

  /** The carve-outs, read from the data map rather than restated in copy. */
  const carveOuts = DATA_MAP.filter(
    (entry) => entry.subject === 'guest' && entry.erasure.kind === 'keep',
  )

  const context = { locale, slug }

  return (
    <PageShell
      locale={locale}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        overdue.length > 0 ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangleIcon className="size-3" aria-hidden />
            {t('overdue', { count: overdue.length })}
          </Badge>
        ) : (
          <Badge variant="outline">{t('openCount', { count: open.length })}</Badge>
        )
      }
    >
      {query.erased === 'queued' && (
        <p className="border-border bg-card rounded-lg border p-4 text-sm">{t('erasureQueued')}</p>
      )}

      {query.erased === 'pending' && (
        // Recorded but not running. The obligation is real either way, and the
        // owner must not be told it is in progress when nothing picked it up.
        <p className="border-[color:var(--bo-warning-500)] bg-card rounded-lg border p-4 text-sm">
          {t('erasurePending')}
        </p>
      )}

      {query.error === 'unknown-guest' && (
        <p className="border-border bg-card rounded-lg border p-4 text-sm">{t('unknownGuest')}</p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* The confirmation screen — carve-outs first, button last            */}
      {/* ------------------------------------------------------------------ */}
      {pending && (
        <section className="border-[color:var(--bo-danger-500)] bg-card rounded-lg border p-5">
          <h2 className="text-base font-semibold">
            {t('confirmTitle', { name: pending.name ?? pending.id })}
          </h2>

          <p className="text-muted-foreground mt-2 text-sm">{t('confirmBody')}</p>

          <ul className="mt-4 space-y-3 text-sm">
            {carveOuts.map((entry) => (
              <li key={entry.table} className="border-border border-l-2 pl-3">
                <p className="font-medium">{t(`tables.${entry.table}` as never)}</p>
                <p className="text-muted-foreground">
                  {entry.erasure.kind === 'keep' ? entry.erasure.why : ''}
                </p>
              </li>
            ))}
          </ul>

          <form action={applyErasure.bind(null, context)} className="mt-5 flex gap-3">
            <input type="hidden" name="guestId" value={pending.id} />
            <Button type="submit" variant="destructive">
              {t('confirmErase')}
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/${slug}/console/privacy`}>{t('cancel')}</Link>
            </Button>
          </form>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Find the person                                                     */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="bo-label">{t('findTitle')}</h2>

        {/*
          A plain GET form. The search term belongs in the URL — an owner
          working through several requests wants the back button to work — and
          this needs no JavaScript to be usable at a reception desk.
        */}
        <form className="mt-2 flex max-w-md gap-2">
          <Input
            name="q"
            defaultValue={query.q ?? ''}
            placeholder={t('findPlaceholder')}
            aria-label={t('findTitle')}
          />
          <Button type="submit" variant="secondary">
            <SearchIcon className="size-4" aria-hidden />
            <span className="sr-only">{t('findTitle')}</span>
          </Button>
        </form>

        {query.q && matches.length === 0 && (
          <p className="text-muted-foreground mt-4 text-sm">{t('noMatches')}</p>
        )}

        <ul className="mt-4 space-y-2">
          {matches.map((subject) => (
            <li
              key={subject.id}
              className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {subject.erased ? t('alreadyErased') : (subject.name ?? t('noName'))}
                </p>
                <p className="text-muted-foreground truncate text-sm">
                  {[subject.email, subject.phone].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('stays', { count: subject.stays })}
                  {subject.lastStay ? ` · ${subject.lastStay}` : ''}
                </p>
              </div>

              <div className="flex gap-2">
                <form action={requestExport.bind(null, context)}>
                  <input type="hidden" name="guestId" value={subject.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    <DownloadIcon className="size-4" aria-hidden />
                    {t('export')}
                  </Button>
                </form>

                {!subject.erased && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${slug}/console/privacy?erase=${subject.id}`}>{t('erase')}</Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      {/* ------------------------------------------------------------------ */}
      {/* The work queue                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="bo-label">{t('requestsTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('requestsBody')}</p>

        {requests.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t('noRequests')}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {requests.map((request) => {
              const late = request.status === 'open' && request.dueBy.getTime() < Date.now()

              return (
                <li
                  key={request.id}
                  className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {t(`kinds.${request.kind}`)} · {request.guestName ?? request.guestId}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {request.status === 'open'
                        ? t('dueBy', { date: request.dueBy.toISOString().slice(0, 10) })
                        : t('answeredOn', {
                            date: (request.completedAt ?? request.createdAt)
                              .toISOString()
                              .slice(0, 10),
                          })}
                    </p>
                  </div>

                  <Badge
                    variant={
                      late ? 'destructive' : request.status === 'open' ? 'outline' : 'secondary'
                    }
                  >
                    {late ? t('late') : t(`statuses.${request.status}`)}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Separator />

      {/* ------------------------------------------------------------------ */}
      {/* What we keep, generated from the same declaration the sweep runs    */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="bo-label flex items-center gap-2">
          <ShieldIcon className="size-3.5" aria-hidden />
          {t('retentionTitle')}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t('retentionBody')}</p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {declaredPeriods()
            .filter((period) => !period.period.startsWith('kept'))
            .map((period) => (
              <div key={period.table} className="border-border rounded-lg border p-3">
                <dt className="text-sm font-medium">{period.table}</dt>
                <dd className="text-muted-foreground text-xs">{period.period}</dd>
              </div>
            ))}
        </dl>
      </section>
    </PageShell>
  )
}
