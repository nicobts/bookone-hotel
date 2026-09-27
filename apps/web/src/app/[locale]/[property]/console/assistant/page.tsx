import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BotIcon } from 'lucide-react'
import { listOwnerAnswers } from '@bookone/core/concierge'
import { PageShell } from '@/components/shell/page-shell'
import { hasFeature, requireOwner } from '@/lib/auth/current-property'
import { Button } from '@bookone/ui/components/button'
import { Textarea } from '@bookone/ui/components/textarea'
import { askAction } from './actions'

/**
 * The owner's assistant (AG-06, Guest Desk WP0.5/0.7).
 *
 * Read-only answers about the property, from its own rows: arrivals, missing
 * pre-arrival documents, open complaints, what waits for approval. The same
 * agent answers on WhatsApp once that channel exists; this page is how an owner
 * reaches it today, and how the demo shows it without a terminal.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; property: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { property } = await requireOwner(locale, slug)
  if (!(await hasFeature(property.id, 'concierge'))) notFound()

  const asked = (await searchParams).asked === '1'
  const answers = await listOwnerAnswers(property.id)
  const t = await getTranslations('console.assistant')
  const context = { locale, slug }
  const when = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  })

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      {/* The agent answers in a second or two; one refresh fetches it. */}
      {asked && <meta httpEquiv="refresh" content={`3;url=/${locale}/${slug}/console/assistant`} />}

      <form action={askAction.bind(null, context)} className="flex flex-col gap-2">
        <Textarea name="message" rows={2} required placeholder={t('placeholder')} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">{t('examples')}</p>
          <Button type="submit" size="sm">
            {t('ask')}
          </Button>
        </div>
      </form>

      {asked && <p className="text-muted-foreground text-sm">{t('working')}</p>}

      <ol className="flex flex-col gap-4">
        {answers.map((answer) => (
          <li key={answer.runId} className="bg-card rounded-lg border p-4">
            <p className="text-muted-foreground text-xs">{when.format(answer.at)}</p>
            <p className="text-foreground mt-1 text-sm font-medium">{answer.question}</p>
            <p className="text-foreground mt-2 flex items-start gap-2 text-sm">
              <BotIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{answer.reply || t('notUnderstood')}</span>
            </p>
          </li>
        ))}
      </ol>
    </PageShell>
  )
}
