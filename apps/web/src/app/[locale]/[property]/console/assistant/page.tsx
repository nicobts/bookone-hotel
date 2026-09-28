import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { UIMessage } from 'ai'
import { listOwnerAnswers } from '@bookone/core/concierge'
import { PageShell } from '@/components/shell/page-shell'
import { AgentChat } from '@/components/agents/agent-chat'
import { hasFeature, requireOwner } from '@/lib/auth/current-property'

/**
 * The owner's assistant (AG-06), on the platform's shared chat interface
 * (ADR-037): the same component as the agents page's preview and the operator
 * playground. Owner only, and only with the concierge module (ADR-019).
 *
 * It opens on the owner's recent questions, so the page reads as a
 * conversation rather than a form. The answers are the assistant's own, read
 * from its runs; it only reads, so there is nothing here to preview — this is
 * the real thing.
 */
export default async function AssistantPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { property } = await requireOwner(locale, slug)
  if (!(await hasFeature(property.id, 'concierge'))) notFound()

  const t = await getTranslations('console.assistant')
  const answers = (await listOwnerAnswers(property.id)).slice(0, 20).reverse()

  const initialMessages: UIMessage[] = answers.flatMap((answer) => [
    { id: `${answer.runId}-q`, role: 'user', parts: [{ type: 'text', text: answer.question }] },
    {
      id: `${answer.runId}-a`,
      role: 'assistant',
      parts: [{ type: 'text', text: answer.reply || t('notUnderstood') }],
    },
  ])

  return (
    <PageShell locale={locale} title={t('title')} subtitle={t('subtitle')}>
      <div className="bg-card flex h-[calc(100dvh-9rem)] min-h-[28rem] flex-col rounded-lg border">
        <AgentChat
          body={{ property: slug, locale, agent: 'AG-06' }}
          initialMessages={initialMessages}
          suggestions={t.raw('suggestions') as string[]}
          placeholder={t('placeholder')}
          emptyTitle={t('emptyTitle')}
          emptyDescription={t('emptyDescription')}
        />
      </div>
    </PageShell>
  )
}
