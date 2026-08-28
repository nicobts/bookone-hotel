import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon } from 'lucide-react'
import { PageShell } from '@/components/shell/page-shell'
import { requireProperty } from '@/lib/auth/current-property'

/**
 * Exceptions — the console's reason to exist (PRD C1, D15).
 *
 * Unreflected reservations, failed payments, pre-arrival incomplete at T-12h,
 * Alloggiati unconfirmed, escalated messages, reconciliation discrepancies —
 * each with a one-tap resolution. Built in Sprint 4.
 *
 * The empty state is the *success* state here, which is why it reads as
 * reassurance rather than as an absence. A hotel whose exceptions inbox is
 * empty is a hotel the platform ran without them.
 */
export default async function ExceptionsPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)
  await requireProperty(locale, slug)

  const t = await getTranslations('console.exceptions')

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      <div className="border-border flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center">
        <CheckCircle2Icon className="size-6 text-[color:var(--bo-success-500)]" aria-hidden />
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      </div>
    </PageShell>
  )
}
