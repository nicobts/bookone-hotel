import { getTranslations } from 'next-intl/server'
import { BotIcon, UserIcon } from 'lucide-react'
import type { MessageRow } from '@bookone/core/concierge'

/**
 * The conversation, as the guest sees it (E3.2).
 *
 * ## Four authors, three appearances
 *
 * `guest` is on the right. `agent` and `staff` are both on the left and both
 * marked — the concierge carries an icon and the property's replies do not,
 * which is enough to tell them apart without labelling every line "AI". The
 * handover is meant to be continuous from the guest's side; what they need is
 * to know *which* answers came from software, not a running commentary.
 *
 * `system` is neither: it is the product speaking about itself — the AI
 * disclosure, an arrival note — and it is rendered as centred small print so it
 * reads as a note about the conversation rather than a turn in it.
 *
 * ## Oldest first, and no auto-scroll
 *
 * A thread of four messages is not a chat client. Reversing it to put the newest
 * on top would be right for a support inbox with hundreds and wrong here, where
 * the whole exchange fits on a phone screen and reading it in order is how a
 * conversation works.
 */
export async function Thread({ messages, locale }: { messages: MessageRow[]; locale: string }) {
  const t = await getTranslations('stay.messages')

  if (messages.length === 0) {
    return <p className="text-muted-foreground mt-4 text-sm">{t('empty')}</p>
  }

  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })

  return (
    <ol className="mt-5 flex flex-col gap-3">
      {messages.map((message) => {
        if (message.author === 'system') {
          return (
            <li
              key={message.id}
              className="text-muted-foreground mx-auto max-w-[85%] text-center text-xs leading-relaxed text-balance"
            >
              {message.body}
            </li>
          )
        }

        const mine = message.author === 'guest'

        return (
          <li key={message.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
            <div className="max-w-[85%]">
              {!mine && (
                <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px]">
                  {message.author === 'agent' ? (
                    <BotIcon className="size-3" aria-hidden />
                  ) : (
                    <UserIcon className="size-3" aria-hidden />
                  )}
                  {message.author === 'agent' ? t('fromAssistant') : t('fromProperty')}
                </p>
              )}

              <div
                className={
                  mine
                    ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-line'
                    : 'bg-muted text-foreground rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm whitespace-pre-line'
                }
              >
                {message.body}
              </div>

              <p
                className={`text-muted-foreground mt-1 text-[11px] ${mine ? 'text-right' : 'text-left'}`}
              >
                <time dateTime={message.createdAt.toISOString()}>
                  {time.format(message.createdAt)}
                </time>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
