import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { listExceptions, type ExceptionItem } from '@bookone/core/db'
import { PageShell } from '@/components/shell/page-shell'
import { requireProperty } from '@/lib/auth/current-property'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { retryReflectionAction } from './actions'

/**
 * Exceptions — the console's reason to exist (PRD C1, D15).
 *
 * Only what needs a person. Everything else has handled itself, which is what
 * makes the empty state the *success* state here rather than an absence — a
 * hotel whose inbox is empty is a hotel the platform ran without them.
 *
 * Read through `withUser`, so what appears is what the database says this
 * person may see (ADR-018), not what a filter in this file remembered to apply.
 */
export default async function ExceptionsPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property } = await requireProperty(locale, slug)
  const exceptions = await listExceptions(user.id, property.id)

  const t = await getTranslations('console.exceptions')
  const context = { locale, slug }

  return (
    <PageShell
      locale={locale}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        exceptions.length > 0 ? (
          <Badge variant="secondary" className="num">
            {t('items', { count: exceptions.length })}
          </Badge>
        ) : null
      }
    >
      {exceptions.length === 0 ? (
        <div className="border-border flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <CheckCircle2Icon className="size-6 text-[color:var(--bo-success-500)]" aria-hidden />
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {exceptions.map((item) => (
            <ExceptionRow key={item.id} item={item} locale={locale} context={context} />
          ))}
        </ul>
      )}
    </PageShell>
  )
}

async function ExceptionRow({
  item,
  locale,
  context,
}: {
  item: ExceptionItem
  locale: string
  context: { locale: string; slug: string }
}) {
  const t = await getTranslations('console.exceptions')

  const title =
    item.kind === 'unreflected-reservation'
      ? t('unreflectedTitle')
      : item.kind === 'alloggiati-overdue'
        ? t('alloggiatiTitle')
        : t('discrepancyTitle')

  const body =
    item.kind === 'unreflected-reservation'
      ? t('unreflectedBody')
      : item.kind === 'alloggiati-overdue'
        ? t('alloggiatiBody')
        : t('discrepancyBody')

  return (
    <li className="bg-card flex items-start gap-3 rounded-lg border p-4">
      <TriangleAlertIcon
        className="mt-0.5 size-4 shrink-0 text-[color:var(--bo-warning-500)]"
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{body}</p>

        <p className="text-muted-foreground mt-2 text-xs">
          {/* Identifiers are tabular: these get read aloud down a phone and
              compared against a PMS screen, character by character. */}
          <span className="num">{item.subject}</span>
          {' · '}
          <span>
            {t('reason')}: {item.code === 'pending' ? t('waiting') : item.code}
          </span>
        </p>

        {item.detail && (
          <p className="text-muted-foreground mt-1 text-xs opacity-80">{item.detail}</p>
        )}
      </div>

      <div className="shrink-0">
        {/*
          One action per row (PRD C1: each with a one-tap resolution).

          A retryable exception offers a retry; a discrepancy offers a review,
          because retrying a comparison produces the same disagreement — it
          needs a decision, not another attempt. Review is still a placeholder
          and stays disabled: a button that does nothing is worse than one that
          says what it will do.
        */}
        {item.kind === 'alloggiati-overdue' ? (
          // Opens the arrival screen rather than firing a retry from here. A
          // late filing is usually late because the party is incomplete, and
          // that screen is where the missing fields are listed.
          <Button asChild variant="outline" size="sm">
            <a href={`/${context.locale}/${context.slug}/console/arrivals/${item.subject}`}>
              {t('review')}
            </a>
          </Button>
        ) : item.retryable ? (
          <form action={retryReflectionAction.bind(null, context)}>
            <input type="hidden" name="reservationId" value={item.subject} />
            <Button type="submit" variant="outline" size="sm">
              <RefreshCwIcon className="size-3.5" aria-hidden />
              {t('retry')}
            </Button>
          </form>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {t('review')}
          </Button>
        )}
      </div>

      <span className="sr-only">{new Date(item.occurredAt).toLocaleString(locale)}</span>
    </li>
  )
}
