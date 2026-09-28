'use client'

import type { UIMessage } from 'ai'
import { useTranslations } from 'next-intl'
import { Chat } from '@bookone/ui/components/chat/chat'
import { RunDetails, type RunData } from './run-details'

/**
 * The console's chat with an agent: the shared chat interface (ADR-037) over
 * the console endpoint (ADR-038), with each reply's run details underneath.
 * Used by the owner's assistant page and by the agents page's preview.
 */
export function AgentChat({
  body,
  initialMessages,
  suggestions,
  placeholder,
  emptyTitle,
  emptyDescription,
}: {
  body: {
    property: string
    locale: string
    agent: 'AG-01' | 'AG-06'
    reservationId?: string | null
  }
  initialMessages?: UIMessage[]
  suggestions: string[]
  placeholder: string
  emptyTitle: string
  emptyDescription: string
}) {
  const t = useTranslations('common')

  return (
    <Chat
      api="/api/agents/chat"
      body={body}
      {...(initialMessages ? { initialMessages } : {})}
      suggestions={suggestions}
      placeholder={placeholder}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      assistantLabel="AI"
      thinkingLabel={t('thinking')}
      renderData={(part) =>
        part.type === 'data-run' ? <RunDetails data={part.data as RunData} /> : null
      }
    />
  )
}
