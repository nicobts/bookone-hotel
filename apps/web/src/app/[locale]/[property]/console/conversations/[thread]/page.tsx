import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BotIcon, FlaskConicalIcon } from 'lucide-react'
import { getThread } from '@bookone/core/db'
import { PageShell } from '@/components/shell/page-shell'
import { requireProperty } from '@/lib/auth/current-property'
import { formatDate } from '@/components/booking/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { handBack, reply, takeOver } from './actions'

/**
 * One conversation, from the property's side (E3.3).
 *
 * The acceptance criterion is that a handoff carries the stay card and a thread
 * summary, and that takeover and return are one tap. Both shape the layout:
 *
 * **The stay card sits above the composer, not behind a link.** A receptionist
 * who has to open a second screen to find out whether the guest has checked in
 * will ask the guest instead — which is the thing E3.3 exists to prevent.
 *
 * **Agent messages are marked.** Not to disclaim them to staff, but because an
 * owner reading the thread needs to know which sentences their property is
 * answerable for as *authored* rather than merely sent. The reason a reply
 * escalated is shown here and never to the guest: "no stored answer matched" is
 * something a person can act on and a guest cannot.
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ locale: string; property: string; thread: string }>
}) {
  const { locale, property: slug, thread: threadId } = await params
  setRequestLocale(locale)

  const { user, property } = await requireProperty(locale, slug)

  const thread = await getThread(user.id, property.id, threadId)
  if (!thread) notFound()

  const t = await getTranslations('console.conversations')
  const context = { locale, slug, threadId }

  const mine = thread.assignedTo === user.id
  const time = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <PageShell
      locale={locale}
      title={thread.guestName ?? thread.reference}
      subtitle={`${formatDate(thread.arrivalDate, locale)} → ${formatDate(thread.departureDate, locale)}`}
      actions={
        mine ? (
          <form action={handBack.bind(null, context)}>
            <Button type="submit" variant="outline" size="sm">
              {t('handBack')}
            </Button>
          </form>
        ) : (
          <form action={takeOver.bind(null, context)}>
            <Button type="submit" size="sm">
              {t('takeOver')}
            </Button>
          </form>
        )
      }
    >
      {/* --------------------------------------------------------- stay card */}
      <section className="bg-card rounded-lg border p-4">
        <h2 className="bo-label text-muted-foreground mb-3">{t('stayCard')}</h2>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <Fact label={t('facts.reference')} value={thread.reference || '—'} />
          <Fact label={t('facts.language')} value={thread.locale.toUpperCase()} />
          <Fact
            label={t('facts.arrival')}
            value={
              thread.journey.expectedArrivalTime
                ? `${t(`journey.arrival.${thread.journey.arrival}`)} · ${thread.journey.expectedArrivalTime}`
                : t(`journey.arrival.${thread.journey.arrival}`)
            }
          />
          <Fact
            label={t('facts.precheckin')}
            value={t(`journey.precheckin.${thread.journey.precheckin}`)}
          />
          <Fact
            label={t('facts.alloggiati')}
            value={t(`journey.alloggiati.${thread.journey.alloggiati}`)}
          />
          <Fact
            label={t('facts.departure')}
            value={t(`journey.departure.${thread.journey.departure}`)}
          />
        </dl>

        {thread.escalationReason && (
          <p className="text-muted-foreground mt-3 text-xs">
            {/* Staff-only. A guest reading "the match score was 0.31" learns nothing. */}
            {t('escalatedBecause', { reason: thread.escalationReason })}
          </p>
        )}
      </section>

      <Separator />

      {/* --------------------------------------------------------- the thread */}
      <section>
        <h2 className="bo-label text-muted-foreground mb-3">{t('thread')}</h2>

        <ol className="flex flex-col gap-4">
          {thread.messages.map((message) => (
            <li key={message.id}>
              <p className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px]">
                {message.author === 'agent' && <BotIcon className="size-3" aria-hidden />}
                <span>
                  {message.author === 'guest'
                    ? (thread.guestName ?? t('authors.guest'))
                    : message.author === 'agent'
                      ? t('authors.agent')
                      : message.author === 'system'
                        ? t('authors.system')
                        : (message.authorName ?? t('authors.staff'))}
                </span>
                <time dateTime={message.createdAt.toISOString()}>
                  {time.format(message.createdAt)}
                </time>
              </p>
              <p
                className={
                  message.author === 'system'
                    ? 'text-muted-foreground text-xs italic'
                    : 'text-foreground text-sm whitespace-pre-line'
                }
              >
                {message.body}
              </p>
            </li>
          ))}
        </ol>

        <form action={reply.bind(null, context)} className="mt-6 flex flex-col gap-2">
          <Label htmlFor="body" className="sr-only">
            {t('replyLabel')}
          </Label>
          <Textarea id="body" name="body" rows={3} required placeholder={t('replyPlaceholder')} />
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              {t('send')}
            </Button>
          </div>
        </form>

        {/* MEMO: disappears when an LlmProvider is registered. */}
        <p className="text-muted-foreground mt-4 flex items-start gap-2 text-xs">
          <FlaskConicalIcon
            className="mt-0.5 size-3.5 shrink-0 text-[color:var(--bo-warning-500)]"
            aria-hidden
          />
          {t('noModel')}
        </p>
      </section>
    </PageShell>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground mt-0.5 font-medium">{value}</dd>
    </div>
  )
}
