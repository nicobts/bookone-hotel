import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { listExceptions, type ExceptionItem } from '@bookone/core/db'
import type { Feature } from '@bookone/core/onboarding'
import { PageShell } from '@/components/shell/page-shell'
import { KNOWN_OBLIGATION_ERRORS } from '@/lib/compliance/errors'
import { propertyFeatures, requireProperty } from '@/lib/auth/current-property'
import { Badge } from '@bookone/ui/components/badge'
import { Button } from '@bookone/ui/components/button'
import { PendingButton } from '@bookone/ui/components/pending-button'
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
/** Which module raises each kind of exception. */
const EXCEPTION_FEATURE: Partial<Record<ExceptionItem['kind'], Feature>> = {
  'unreflected-reservation': 'pms_sync',
  discrepancy: 'pms_sync',
  // The only adapter with obligations today; WP1.3–1.4 carry their own
  // feature on the item when they add theirs.
  'compliance-deadline': 'alloggiati',
}

export default async function ExceptionsPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { user, property } = await requireProperty(locale, slug)
  const features = await propertyFeatures(property.id)
  // An exception from a module the property does not have is not one it can
  // act on — a filing it is not making, a PMS it is not synced to (ADR-019).
  const exceptions = (await listExceptions(user.id, property.id)).filter((item) => {
    const feature = EXCEPTION_FEATURE[item.kind]
    return feature === undefined || features.has(feature)
  })

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
            <ExceptionRow
              key={item.id}
              item={item}
              locale={locale}
              timeZone={property.timezone}
              context={context}
            />
          ))}
        </ul>
      )}
    </PageShell>
  )
}

async function ExceptionRow({
  item,
  locale,
  timeZone,
  context,
}: {
  item: ExceptionItem
  locale: string
  timeZone: string
  context: { locale: string; slug: string }
}) {
  const t = await getTranslations('console.exceptions')
  const states = await getTranslations('console.arrival.obligation.states')
  const errors = await getTranslations('console.arrival.obligation.errors')

  const title =
    item.kind === 'unreflected-reservation'
      ? t('unreflectedTitle')
      : item.kind === 'compliance-deadline'
        ? t('complianceTitle')
        : t('discrepancyTitle')

  // A filing's row is its deadline, in the property's words: the one number an
  // owner acts on (WP1.5).
  const deadline = new Date(item.occurredAt).toLocaleString(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const late = new Date(item.occurredAt).getTime() <= Date.now()

  const body =
    item.kind === 'unreflected-reservation'
      ? t('unreflectedBody')
      : item.kind === 'compliance-deadline'
        ? late
          ? t('complianceLate', { deadline })
          : t('complianceBody', { deadline })
        : t('discrepancyBody')

  const knownError =
    item.kind === 'compliance-deadline' && item.detail
      ? KNOWN_OBLIGATION_ERRORS[item.detail]
      : undefined
  const detail = knownError ? errors(knownError) : item.detail

  const reason =
    item.kind === 'compliance-deadline'
      ? states.has(item.code)
        ? states(item.code)
        : item.code
      : item.code === 'pending'
        ? t('waiting')
        : item.code

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
            {t('reason')}: {reason}
          </span>
        </p>

        {detail && <p className="text-muted-foreground mt-1 text-xs opacity-80">{detail}</p>}
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
        {item.kind === 'compliance-deadline' && item.reservationId ? (
          // Opens the arrival screen rather than firing a retry from here. A
          // late filing is usually late because the party is incomplete, and
          // that screen is where the missing fields are listed. A period
          // filing has no arrival, and falls through to the disabled review.
          <Button asChild variant="outline" size="sm">
            <a href={`/${context.locale}/${context.slug}/console/arrivals/${item.reservationId}`}>
              {t('review')}
            </a>
          </Button>
        ) : item.retryable ? (
          <form action={retryReflectionAction.bind(null, context)}>
            <input type="hidden" name="reservationId" value={item.subject} />
            <PendingButton
              variant="outline"
              size="sm"
              icon={<RefreshCwIcon className="size-3.5" aria-hidden />}
            >
              {t('retry')}
            </PendingButton>
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
