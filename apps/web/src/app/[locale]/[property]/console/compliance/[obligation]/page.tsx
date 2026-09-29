import { notFound } from 'next/navigation'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowLeftIcon, CheckCircle2Icon, DownloadIcon, FileCheckIcon } from 'lucide-react'
import {
  ManualFallbackUnavailable,
  getObligationDetail,
  localDate,
  type ManualFallback,
} from '@bookone/core/compliance'
import { PageShell } from '@/components/shell/page-shell'
import { requireCompliance } from '@/lib/compliance/access'
import { KNOWN_OBLIGATION_ERRORS } from '@/lib/compliance/errors'
import { buildManualFallback } from '@/lib/compliance/fallback'
import { Badge } from '@bookone/ui/components/badge'
import { Button } from '@bookone/ui/components/button'
import { Input } from '@bookone/ui/components/input'
import { Label } from '@bookone/ui/components/label'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { recordManualFilingAction } from './actions'

/**
 * One filing, and the manual route for it (Guest Desk WP1.6, ADR-026).
 *
 * What a receptionist opens when a filing is theirs: why, the portal's steps,
 * the file to upload, and the form that records the filing once the portal
 * has taken it — the protocol number, the day, and the receipt. Once recorded,
 * the same screen is the proof: the receipt, its fingerprint, and the file.
 */
export default async function ObligationPage({
  params,
}: {
  params: Promise<{ locale: string; property: string; obligation: string }>
}) {
  const { locale, property: slug, obligation: obligationId } = await params
  setRequestLocale(locale)

  const { user, property, adapterIds } = await requireCompliance(locale, slug)
  const obligation = await getObligationDetail(user.id, property.id, obligationId)
  // Another property's id, or a module that is off: the same 404.
  if (!obligation || !adapterIds.includes(obligation.adapterId)) notFound()

  const t = await getTranslations('console.compliance')
  const errors = await getTranslations('console.arrival.obligation.errors')
  const format = await getFormatter()
  const base = `/${locale}/${slug}/console/compliance`
  const now = new Date()

  const authority = t.has(`authorities.${obligation.authority}`)
    ? t(`authorities.${obligation.authority}`)
    : obligation.authority
  const subject = obligation.reference ?? obligation.periodDate ?? t('noSubject')

  // A filing a person may still record: not acknowledged, and not with the
  // authority awaiting its answer (core refuses both anyway).
  const recordable = obligation.state !== 'acknowledged' && obligation.state !== 'submitted'

  let fallback: ManualFallback | null = null
  let notReady: string[] | null = null
  if (recordable) {
    try {
      fallback = await buildManualFallback(property.id, obligation)
    } catch (error) {
      if (!(error instanceof ManualFallbackUnavailable)) throw error
      notReady = error.reasons
    }
  }

  const known = obligation.lastError ? KNOWN_OBLIGATION_ERRORS[obligation.lastError] : undefined
  const deadline = format.dateTime(obligation.deadline, {
    timeZone: property.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  const receipt = obligation.evidence?.receipt ?? {}
  const context = { locale, slug, obligationId }

  return (
    <PageShell
      locale={locale}
      title={`${authority} · ${subject}`}
      subtitle={t(`types.${obligation.type}`)}
      actions={
        <Button asChild size="sm" variant="ghost">
          <a href={base}>
            <ArrowLeftIcon className="size-4" aria-hidden />
            {t('back')}
          </a>
        </Button>
      }
    >
      <section className="bg-card flex max-w-2xl flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('statusTitle')}</p>
          <Badge
            variant={
              obligation.state === 'acknowledged'
                ? 'secondary'
                : obligation.state === 'manual'
                  ? 'destructive'
                  : 'outline'
            }
            className="gap-1"
          >
            {obligation.state === 'acknowledged' && (
              <CheckCircle2Icon className="size-3 text-[color:var(--bo-success-500)]" aria-hidden />
            )}
            {t(`states.${obligation.state}`)}
          </Badge>
        </div>
        <dl className="text-muted-foreground grid gap-1 text-xs">
          <div className="flex justify-between gap-4">
            <dt>{t('deadline')}</dt>
            <dd className="text-right">
              {deadline} · {format.relativeTime(obligation.deadline, now)}
            </dd>
          </div>
        </dl>
        {obligation.lastError && obligation.state !== 'acknowledged' && (
          <p
            className={`text-xs ${obligation.state === 'manual' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {known ? errors(known) : obligation.lastError}
          </p>
        )}
        {obligation.state === 'submitted' && (
          <p className="text-muted-foreground text-xs">{t('submittedHint')}</p>
        )}
      </section>

      {recordable && (
        <section className="flex max-w-2xl flex-col gap-4 rounded-lg border border-dashed p-4">
          <div>
            <h2 className="text-sm font-medium">{t('manualTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('manualHint')}</p>
          </div>

          {notReady && (
            <div className="text-destructive text-xs">
              <p>{t('notReady')}</p>
              <ul className="mt-1 list-disc pl-5">
                {notReady.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {fallback && (
            <>
              {/* The portal is Italian only, so its steps are too. */}
              <ol className="list-decimal space-y-1 pl-5 text-xs" lang="it">
                {fallback.instructions.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <Button asChild size="sm" variant="outline" className="self-start">
                <a href={`${base}/${obligation.id}/fallback`} download>
                  <DownloadIcon className="size-4" aria-hidden />
                  {t('download')}
                </a>
              </Button>
            </>
          )}

          <form
            action={recordManualFilingAction.bind(null, context)}
            className="border-border flex flex-col gap-3 border-t pt-4"
          >
            <div>
              <h3 className="text-sm font-medium">{t('recordTitle')}</h3>
              <p className="text-muted-foreground mt-1 text-xs">{t('recordHint')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="protocol">{t('protocol')}</Label>
                <Input id="protocol" name="protocol" required maxLength={64} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="filedOn">{t('filedOn')}</Label>
                <Input
                  id="filedOn"
                  name="filedOn"
                  type="date"
                  required
                  defaultValue={localDate(now, property.timezone)}
                  max={localDate(now, property.timezone)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="receipt">{t('receiptFile')}</Label>
              <Input
                id="receipt"
                name="receipt"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
              />
              <p className="text-muted-foreground text-xs">{t('receiptFileHint')}</p>
            </div>
            <PendingButton
              size="sm"
              className="self-start"
              icon={<FileCheckIcon className="size-4" aria-hidden />}
            >
              {t('record')}
            </PendingButton>
          </form>
        </section>
      )}

      {obligation.evidence && (
        <section className="bg-card flex max-w-2xl flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{t('proofTitle')}</h2>
          <dl className="text-muted-foreground grid gap-1 text-xs">
            <div className="flex justify-between gap-4">
              <dt>{t('source')}</dt>
              <dd>
                {t(`sources.${obligation.evidence.source === 'manual' ? 'manual' : 'channel'}`)}
              </dd>
            </div>
            {typeof receipt.protocol === 'string' && (
              <div className="flex justify-between gap-4">
                <dt>{t('protocol')}</dt>
                <dd className="num">{receipt.protocol}</dd>
              </div>
            )}
            {typeof receipt.filedOn === 'string' && (
              <div className="flex justify-between gap-4">
                <dt>{t('filedOn')}</dt>
                <dd className="num">{receipt.filedOn}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt>{t('recordedAt')}</dt>
              <dd className="num">
                {format.dateTime(obligation.evidence.recordedAt, {
                  timeZone: property.timezone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              {/* The receipt's hash: what an inspector compares against. */}
              <dt>{t('fingerprint')}</dt>
              <dd className="num truncate">{obligation.evidence.hash}</dd>
            </div>
          </dl>
          {obligation.attachment &&
            (obligation.attachment.deletedAt ? (
              <p className="text-muted-foreground text-xs">
                {t('fileDeleted', {
                  date: format.dateTime(obligation.attachment.deletedAt, {
                    timeZone: property.timezone,
                    dateStyle: 'medium',
                  }),
                })}
              </p>
            ) : (
              <Button asChild size="sm" variant="outline" className="self-start">
                <a href={`${base}/${obligation.id}/receipt`} target="_blank" rel="noreferrer">
                  <DownloadIcon className="size-4" aria-hidden />
                  {t('openFile')}
                </a>
              </Button>
            ))}
        </section>
      )}
    </PageShell>
  )
}
