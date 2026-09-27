'use client'

import * as React from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { Bubble, Message, MessageAvatar, MessageContent, MessageFooter } from './message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './message-scroller'
import { PromptForm } from './prompt-form'

/**
 * The chat interface (ADR-037), speaking the AI SDK UI message protocol, so
 * the same component serves the operator's agent playground today and a
 * hotel-website embed later.
 *
 * It renders what the server streams and nothing else. Parts:
 *   - `text`  — what the assistant said, verbatim as recorded (ADR-022);
 *   - `data-note` — the product speaking about itself (a disclosure, a
 *     handover line), shown as a note rather than as the assistant;
 *   - any other `data-*` part — handed to `renderData`, which is how the
 *     playground shows a run's profile, tools and outcome.
 */
export interface ChatProps {
  /** The endpoint speaking the UI message stream protocol. */
  api: string
  /** Sent with every request, e.g. which stay the tester is speaking as. */
  body?: Record<string, unknown>
  initialMessages?: UIMessage[]
  placeholder?: string
  emptyTitle?: string
  emptyDescription?: string
  suggestions?: string[]
  assistantLabel?: string
  renderData?: (part: { type: string; data: unknown }) => React.ReactNode
}

export function Chat({
  api,
  body,
  initialMessages,
  placeholder,
  emptyTitle = 'Start the conversation',
  emptyDescription,
  suggestions = [],
  assistantLabel = 'AI',
  renderData,
}: ChatProps) {
  const transport = React.useMemo(
    () => new DefaultChatTransport({ api, ...(body ? { body } : {}) }),
    [api, body],
  )
  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    ...(initialMessages ? { messages: initialMessages } : {}),
  })

  const busy = status === 'submitted' || status === 'streaming'
  const send = (text: string) => void sendMessage({ text })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="max-w-sm">
            <p className="text-base font-semibold">{emptyTitle}</p>
            {emptyDescription ? (
              <p className="text-muted-foreground mt-1 text-sm">{emptyDescription}</p>
            ) : null}
          </div>
          {suggestions.length > 0 ? (
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="border-border hover:bg-muted rounded-full border px-3 py-1.5 text-xs transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === 'user'}
                  >
                    <ChatMessage
                      message={message}
                      assistantLabel={assistantLabel}
                      renderData={renderData}
                    />
                  </MessageScrollerItem>
                ))}
                {status === 'submitted' ? (
                  <MessageScrollerItem messageId="thinking">
                    <p className="text-muted-foreground animate-pulse px-11 text-sm">Thinking…</p>
                  </MessageScrollerItem>
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4">
        {error ? (
          <p className="border-destructive/40 text-destructive rounded-md border p-2 text-sm">
            {error.message || 'The request failed.'}
          </p>
        ) : null}
        <PromptForm
          isBusy={busy}
          onSubmit={send}
          onStop={() => void stop()}
          {...(placeholder ? { placeholder } : {})}
        />
      </div>
    </div>
  )
}

function ChatMessage({
  message,
  assistantLabel,
  renderData,
}: {
  message: UIMessage
  assistantLabel: string
  renderData: ChatProps['renderData']
}) {
  const user = message.role === 'user'

  return (
    <Message align={user ? 'end' : 'start'}>
      {!user ? <MessageAvatar>{assistantLabel}</MessageAvatar> : null}
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <Bubble key={index} variant={user ? 'default' : 'muted'}>
                {part.text}
              </Bubble>
            )
          }
          if (part.type === 'data-note') {
            return (
              <Bubble key={index} variant="note">
                {String((part as { data: unknown }).data)}
              </Bubble>
            )
          }
          if (part.type.startsWith('data-') && renderData) {
            return (
              <MessageFooter key={index}>
                {renderData({ type: part.type, data: (part as { data: unknown }).data })}
              </MessageFooter>
            )
          }
          return null
        })}
      </MessageContent>
    </Message>
  )
}
