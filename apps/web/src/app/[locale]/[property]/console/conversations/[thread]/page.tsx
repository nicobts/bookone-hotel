import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BotIcon, FlaskConicalIcon } from 'lucide-react'
import { getThread } from '@bookone/core/db'
import { PageShell } from '@/components/shell/page-shell'
import { requireFeature } from '@/lib/auth/current-property'
import { formatDate } from '@/components/booking/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { handBack, reply, takeOver, undoAction } from './actions'
import {
  listComplaintsForReservation,
  listThreadActions,
  recentRouting,
} from '@bookone/core/concierge'

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

  const { user, property } = await requireFeature(locale, slug, 'inbox')

  const thread = await getThread(user.id, property.id, threadId)
  if (!thread) notFound()

  const t = await getTranslations('console.conversations')
  const categories = await getTranslations('concierge.complaintCategories')
  const context = { locale, slug, threadId }

  // The concierge's actions per run, the hard rule that last handed this over,
  // and this stay's complaints with their SLA (Guest Desk WP0.6).
  const [actions, routing, complaints] = await Promise.all([
    listThreadActions(property.id, threadId),
    recentRouting(property.id, threadId, 1),
    listComplaintsForReservation(property.id, thread.reservationId),
  ])
  const lastRule = routing[0]?.hardRule ?? null
  const now = Date.now()
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })

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

        {lastRule && (
          <p className="text-foreground mt-2 text-xs font-medium">
            {t('handoff', { rule: t.has(`rules.${lastRule}`) ? t(`rules.${lastRule}`) : lastRule })}
          </p>
        )}

        {complaints.length > 0 && (
          <div className="mt-3">
            <p className="text-muted-foreground text-xs">{t('complaints')}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {complaints.map((complaint) => {
                const open = complaint.status !== 'resolved'
                const late = open && complaint.slaDueAt.getTime() < now
                return (
                  <li key={complaint.id} className={late ? 'text-destructive' : 'text-foreground'}>
                    {categories.has(complaint.category)
                      ? categories(complaint.category)
                      : complaint.category}
                    {open &&
                      ` · ${
                        late
                          ? t('slaBreached', { time: clock.format(complaint.slaDueAt) })
                          : t('slaDue', { time: clock.format(complaint.slaDueAt) })
                      }`}
                  </li>
                )
              })}
            </ul>
          </div>
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

              {message.agentRunId && actions.get(message.agentRunId) && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t('actions')}>
                  {actions.get(message.agentRunId)!.map((action) => (
                    <li
                      key={action.callIndex}
                      className="bg-muted/60 text-muted-foreground flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px]"
                    >
                      <span className="font-mono">{action.tool}</span>
                      {action.status === 'pending_approval' && (
                        <span>
                          ·{' '}
                          {action.decision === 'accepted'
                            ? t('approved')
                            : action.decision === 'rejected'
                              ? t('declined')
                              : t('pendingApproval')}
                        </span>
                      )}
                      {action.status === 'refused' && <span>· {t('refused')}</span>}
                      {action.status === 'failed' && <span>· {t('failedAction')}</span>}
                      {action.reversedAt ? (
                        <span>· {t('undone')}</span>
                      ) : action.canReverse ? (
                        <form action={undoAction.bind(null, context)}>
                          <input type="hidden" name="runId" value={action.runId} />
                          <input type="hidden" name="callIndex" value={action.callIndex} />
                          <button type="submit" className="text-foreground underline">
                            {t('undo')}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
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

        {/* How the assistant speaks (ADR-022), stated where staff read its replies. */}
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
