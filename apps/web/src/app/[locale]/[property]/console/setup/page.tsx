import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, CircleIcon, ExternalLinkIcon, LockIcon } from 'lucide-react'
import { buildChecklist, listEntitlements, type ChecklistItem } from '@bookone/core/onboarding'
import { PageShell } from '@/components/shell/page-shell'
import { Link } from '@/i18n/navigation'
import { requireOwner } from '@/lib/auth/current-property'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

/**
 * The property setup checklist (E7.1).
 *
 * ## The whole list, from the first minute
 *
 * Not a wizard that reveals step four when you finish step three. A person
 * deciding whether to start needs to see the whole cost, and the ones who
 * abandon do it at the step they did not know was coming
 * (design-notes/onboarding.md §1).
 *
 * ## Nothing here gates the console
 *
 * Items marked **required** are the ones a booking would fail on anyway; the
 * rest improve the result and block nothing. A checklist presenting theming as
 * equally required as room types is a checklist abandoned at the tourist-tax
 * table.
 *
 * ## It is derived, not stored
 *
 * An item is done when the thing it describes exists. There is no
 * `setup_completed` column to drift out of step with reality and tell a new
 * owner to do something they have already done.
 */
export default async function SetupPage({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { property } = await requireOwner(locale, slug)

  const [checklist, features] = await Promise.all([
    buildChecklist(property.id),
    listEntitlements(property.id),
  ])

  const t = await getTranslations('console.setup')
  if (!checklist) return null

  /** Where each item is actually done. Null when there is nowhere to go yet. */
  const destinations: Partial<Record<ChecklistItem['key'], string>> = {
    identity: `/${slug}/console/settings`,
    rooms: `/${slug}/console/room-types`,
    contact: `/${slug}/console/settings`,
    theming: `/${slug}/console/settings`,
    policy: `/${slug}/console/settings`,
    knowledge: `/${slug}/console/knowledge`,
  }

  const ours = checklist.items.filter((item) => !item.blockedOnUs)
  const oursBlocked = checklist.items.filter((item) => item.blockedOnUs)

  return (
    <PageShell
      locale={locale}
      title={t('title')}
      subtitle={t('progress', { done: checklist.done, total: checklist.total })}
      actions={
        checklist.canTransact ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2Icon className="size-3 text-[color:var(--bo-success-500)]" aria-hidden />
            {t('canTransact')}
          </Badge>
        ) : (
          <Badge variant="outline">{t('cannotTransact')}</Badge>
        )
      }
    >
      {/*
        Said before the list, not after it. An owner reading "you can take
        bookings" stops worrying about the six optional items below, which is
        the difference between finishing this in an evening and putting it off.
      */}
      <p className="text-muted-foreground text-sm">
        {checklist.canTransact ? t('canTransactBody') : t('cannotTransactBody')}
      </p>

      <ul className="flex flex-col gap-2">
        {ours.map((item) => (
          <li key={item.key}>
            <Row item={item} href={destinations[item.key]} locale={locale} />
          </li>
        ))}
      </ul>

      <Separator />

      {/* ------------------------------------------------------- blocked on us */}
      <section>
        <h2 className="bo-label text-muted-foreground mb-3">{t('blockedHeading')}</h2>
        <p className="text-muted-foreground mb-3 text-xs">{t('blockedBody')}</p>

        <ul className="flex flex-col gap-2">
          {oursBlocked.map((item) => (
            <li
              key={item.key}
              className="bg-card flex items-start gap-3 rounded-lg border border-dashed p-4"
            >
              <LockIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">
                  {t(`items.${item.key}.title`)}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t(`items.${item.key}.blocked`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {features.length > 0 && (
        <section>
          <h2 className="bo-label text-muted-foreground mb-3">{t('modules')}</h2>
          <ul className="flex flex-wrap gap-2">
            {features.map((feature) => (
              <li key={feature}>
                <Badge variant="outline">{feature}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  )
}

async function Row({
  item,
  href,
  locale,
}: {
  item: ChecklistItem
  href: string | undefined
  locale: string
}) {
  void locale
  const t = await getTranslations('console.setup')

  const body = (
    <div className="bg-card hover:border-ring/50 flex items-start gap-3 rounded-lg border p-4 transition-colors">
      {item.done ? (
        <CheckCircle2Icon
          className="mt-0.5 size-4 shrink-0 text-[color:var(--bo-success-500)]"
          aria-hidden
        />
      ) : (
        <CircleIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-foreground flex items-center gap-2 text-sm font-medium">
          {t(`items.${item.key}.title`)}
          {/*
            Required is stated on the item, not inferred from its position.
            An owner skipping an optional item should be making an informed
            decision rather than an act of avoidance (design note §1).
          */}
          {item.blocking && !item.done && (
            <Badge variant="outline" className="text-[10px]">
              {t('required')}
            </Badge>
          )}
          {typeof item.detail === 'number' && item.detail > 0 && (
            <span className="text-muted-foreground num text-xs">{item.detail}</span>
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {item.done ? t(`items.${item.key}.done`) : t(`items.${item.key}.todo`)}
        </p>
      </div>

      {href && <ExternalLinkIcon className="text-muted-foreground mt-0.5 size-3.5" aria-hidden />}
    </div>
  )

  return href ? <Link href={href}>{body}</Link> : body
}
