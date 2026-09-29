import { notFound } from 'next/navigation'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, DownloadIcon, FlaskConicalIcon, TriangleAlertIcon } from 'lucide-react'
import { getArrival } from '@bookone/core/db'
import { getSchedinaPreview } from '@bookone/core/journey'
import { configuredCodes } from '@bookone/core/alloggiati'
import {
  readingMismatches,
  registrationToGuestDetails,
  validateParty,
  type DocumentReading,
} from '@bookone/core/alloggiati'
import {
  ALERT_REACHES,
  ManualFallbackUnavailable,
  alloggiatiManualFallback,
  listObligationsForStay,
  type ObligationView,
} from '@bookone/core/compliance'
import { PageShell } from '@/components/shell/page-shell'
import { hasFeature, requireProperty } from '@/lib/auth/current-property'
import { Badge } from '@bookone/ui/components/badge'
import { Button } from '@bookone/ui/components/button'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { Separator } from '@bookone/ui/components/separator'
import { formatDate } from '@/components/booking/format'
import { KNOWN_OBLIGATION_ERRORS } from '@/lib/compliance/errors'
import { confirmDocumentsAction, fileNow, markArrived, retryByChannel } from './actions'

/**
 * One arrival, and the registry filing that follows it (E2.3, E3.1).
 *
 * The screen a receptionist has open when somebody walks in. It answers three
 * questions in the order they get asked: is this the right guest, are they
 * here, and is the police registration done.
 *
 * ## Two things it deliberately shows
 *
 * **What is missing, by guest, in full.** When the party cannot be filed the
 * console lists every absent field for every person at once — because the owner
 * has to go and ask, and a list that reveals one field per round trip takes
 * four conversations with somebody who is standing at the desk.
 *
 * **That nothing was actually filed.** While the channel is a mock, this screen
 * says so. A property that believes its guests are registered when they are not
 * is a property facing a fine for a breach it does not know about — which is a
 * worse failure than the feature being visibly unfinished.
 */
export default async function ArrivalPage({
  params,
}: {
  params: Promise<{ locale: string; property: string; reservation: string }>
}) {
  const { locale, property: slug, reservation: reservationId } = await params
  setRequestLocale(locale)

  const { user, property } = await requireProperty(locale, slug)

  const arrival = await getArrival(user.id, property.id, reservationId)
  if (!arrival) notFound()

  const t = await getTranslations('console.arrival')
  // Without the feature there is no filing to make — the section still shows
  // what the record is missing, which pre-arrival capture needs regardless.
  const filing = await hasFeature(property.id, 'alloggiati')
  // The schedina preview and its confirmation belong to pre-arrival (WP0.4).
  const schedina = (await hasFeature(property.id, 'prearrival'))
    ? // With the registry's codes when they are configured (WP1.2): a birthplace
      // the registry does not know shows here, while the guest is at the desk.
      await getSchedinaPreview(property.id, reservationId, await configuredCodes())
    : null
  const context = { locale, slug, reservationId }

  // The stay's obligations (ADR-039): what is owed, by when, and where it
  // stands. Read under the member's session, like the rest of the page.
  const obligations = filing
    ? await listObligationsForStay(user.id, property.id, reservationId)
    : []
  const format = await getFormatter()
  const now = new Date()

  // The steps for filing by hand, shown when a person has to. Built from the
  // same records as the filing; absent while the record is incomplete, in
  // which case the missing fields below are what to fix first.
  let fallbackSteps: string[] | null = null
  if (
    obligations.some((obligation) => obligation.state === 'manual' || obligation.state === 'failed')
  ) {
    try {
      fallbackSteps = (await alloggiatiManualFallback({ propertyId: property.id, reservationId }))
        .instructions
    } catch (error) {
      if (!(error instanceof ManualFallbackUnavailable)) throw error
    }
  }

  // The same validator the staging path runs, so what the console promises and
  // what the filing accepts cannot disagree.
  const issues = validateParty(
    arrival.party.map((member) => registrationToGuestDetails(member.data)),
    { arrivalDate: arrival.arrivalDate, departureDate: arrival.departureDate },
  )

  const filingLabel =
    {
      pending: t('notFiled'),
      staged: t('staged'),
      submitted: t('submitted'),
      acknowledged: t('acknowledged'),
      failed: t('failed'),
    }[arrival.alloggiati] ?? t('notFiled')

  return (
    <PageShell
      locale={locale}
      title={arrival.guestName ?? arrival.reference}
      subtitle={`${formatDate(arrival.arrivalDate, locale)} → ${formatDate(arrival.departureDate, locale)}`}
      actions={
        arrival.arrival === 'confirmed' ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2Icon className="size-3 text-[color:var(--bo-success-500)]" aria-hidden />
            {t('arrived')}
          </Badge>
        ) : (
          <form action={markArrived.bind(null, context)}>
            <PendingButton>{t('confirmArrival')}</PendingButton>
          </form>
        )
      }
    >
      <section>
        <h2 className="bo-label text-muted-foreground mb-3">{t('party')}</h2>

        <ul className="flex flex-col gap-2">
          {arrival.party.map((member) => (
            <li
              key={member.guestIndex}
              className="bg-card flex items-center justify-between gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-medium">
                  {member.givenName} {member.surname}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t('guest', { n: member.guestIndex + 1 })}
                </p>
                <OcrStatus data={member.data} t={t} />
              </div>

              {member.documentDeleted ? (
                // Deleted is the *good* outcome here (E2.4), so it reads as a
                // completed step rather than an absence.
                <Badge variant="secondary">{t('documentDeleted')}</Badge>
              ) : member.hasDocument ? (
                <Badge variant="outline">{t('documentHeld')}</Badge>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      {schedina && (
        <>
          <section>
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="bo-label text-muted-foreground">{t('schedina')}</h2>

              {schedina.confirmedAt ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2Icon
                    className="size-3 text-[color:var(--bo-success-500)]"
                    aria-hidden
                  />
                  {t('documentsConfirmed')}
                </Badge>
              ) : schedina.ready && schedina.documentsHeld >= schedina.guests.length ? (
                <form action={confirmDocumentsAction.bind(null, context)}>
                  <PendingButton size="sm">{t('confirmDocuments')}</PendingButton>
                </form>
              ) : null}
            </div>

            <p className="text-muted-foreground mb-3 text-xs">{t('schedinaHint')}</p>

            {!schedina.ready && schedina.issues.length > 0 && (
              <p className="text-muted-foreground mb-3 text-xs">
                {t('schedinaNotReady')}{' '}
                {schedina.issues
                  .map((issue) =>
                    issue.guestIndex >= 0
                      ? `${t('guest', { n: issue.guestIndex + 1 })}: ${issue.field}`
                      : issue.field,
                  )
                  .join(', ')}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {schedina.guests.map((guest) => (
                <dl
                  key={guest.guestIndex}
                  className="bg-card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-4 text-xs"
                >
                  {guest.fields.map((field) => (
                    <div key={field.name} className="contents">
                      <dt className="text-muted-foreground">
                        {t.has(`schedinaFields.${field.name}`)
                          ? t(`schedinaFields.${field.name}`)
                          : field.name}
                      </dt>
                      {/* Tabular: these get compared character by character against a document. */}
                      <dd className="num text-foreground truncate font-mono">
                        {field.value || '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>

            <p className="text-muted-foreground mt-3 text-xs">{t('confirmNote')}</p>
          </section>

          <Separator />
        </>
      )}

      <section>
        <h2 className="bo-label text-muted-foreground mb-3">{t('filing')}</h2>

        <div className="bg-card rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-foreground text-sm font-medium">{filingLabel}</p>

            {/*
              Always present while the property files through BookOne, whatever
              the automation did (E2.3 acceptance criterion). The property is
              the declarant; automation they cannot override is automation they
              cannot answer for. Absent when they do not file through us.
            */}
            {filing && (
              <form action={fileNow.bind(null, context)}>
                <PendingButton variant="outline" size="sm">
                  {t('submitNow')}
                </PendingButton>
              </form>
            )}
          </div>

          {arrival.submission && (
            <dl className="text-muted-foreground mt-3 grid gap-1 text-xs">
              {arrival.submission.hasReceipt && (
                <div className="flex justify-between gap-4">
                  <dt>{t('receipt')}</dt>
                  <dd>{arrival.submission.acknowledgedAt ? '✓' : '—'}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt>{t('checksum')}</dt>
                {/* Tabular and truncated: it gets compared against a receipt. */}
                <dd className="num truncate">{arrival.submission.payloadChecksum.slice(0, 16)}…</dd>
              </div>
              {arrival.submission.lastError && (
                <p role="alert" className="text-destructive mt-1">
                  {arrival.submission.lastError}
                </p>
              )}
            </dl>
          )}

          {obligations.map((obligation) => (
            <Obligation
              key={obligation.id}
              obligation={obligation}
              t={t}
              when={`${format.dateTime(obligation.deadline, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })} · ${format.relativeTime(obligation.deadline, now)}`}
              fallback={
                fallbackSteps && (obligation.state === 'manual' || obligation.state === 'failed')
                  ? {
                      steps: fallbackSteps,
                      href: `/${locale}/${slug}/console/compliance/${obligation.id}/fallback`,
                    }
                  : null
              }
              retry={obligation.state === 'manual' ? retryByChannel.bind(null, context) : null}
            />
          ))}

          {issues.length > 0 && (
            <div className="mt-4">
              <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                <TriangleAlertIcon
                  className="size-4 text-[color:var(--bo-warning-500)]"
                  aria-hidden
                />
                {t('missing')}
              </p>
              <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                {issues.map((issue) => (
                  <li key={`${issue.guestIndex}-${issue.field}`}>
                    {issue.guestIndex >= 0 ? `${t('guest', { n: issue.guestIndex + 1 })}: ` : ''}
                    {issue.field}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* MEMO: disappears when a real channel is connected. */}
          <p className="text-muted-foreground mt-4 flex items-start gap-2 text-xs">
            <FlaskConicalIcon
              className="mt-0.5 size-3.5 shrink-0 text-[color:var(--bo-warning-500)]"
              aria-hidden
            />
            {t('simulated')}
          </p>
        </div>
      </section>
    </PageShell>
  )
}

/**
 * What the vision model read from this guest's document, for the person about
 * to confirm (WP0.4): whether the machine-readable zone checked out, and every
 * field where what the guest typed disagrees with the document. A suggestion
 * for a person, never a verdict (ADR-027).
 */
function OcrStatus({
  data,
  t,
}: {
  data: Record<string, unknown>
  t: Awaited<ReturnType<typeof getTranslations<'console.arrival'>>>
}) {
  const reading = data.ocr as DocumentReading | undefined
  if (!reading || typeof reading !== 'object' || !reading.mrz) return null

  const mismatches = readingMismatches(registrationToGuestDetails(data), reading)
  const status = reading.mrz.valid
    ? t('ocrValid')
    : reading.mrz.present
      ? t('ocrInvalid')
      : t('ocrPrinted')

  return (
    <div className="mt-1 space-y-0.5 text-xs">
      <p
        className={
          reading.mrz.valid
            ? 'text-[color:var(--bo-success-500)]'
            : 'text-[color:var(--bo-warning-500)]'
        }
      >
        {status}
      </p>
      {mismatches.length > 0 && (
        <p className="text-destructive">
          {t('ocrMismatch', {
            fields: mismatches
              .map((name) => (t.has(`schedinaFields.${name}`) ? t(`schedinaFields.${name}`) : name))
              .join(', '),
          })}
        </p>
      )}
    </div>
  )
}

/**
 * One obligation on the stay (ADR-039): the authority, the state, the
 * deadline, and — when a person has to act — the file and the steps.
 */
function Obligation({
  obligation,
  t,
  when,
  fallback,
  retry,
}: {
  obligation: ObligationView
  t: Awaited<ReturnType<typeof getTranslations<'console.arrival'>>>
  when: string
  fallback: { steps: string[]; href: string } | null
  /** "Try the channel again", offered once the filing is with a person (WP1.2). */
  retry: ((formData: FormData) => Promise<void>) | null
}) {
  const needsPerson = obligation.state === 'manual'
  const variant =
    obligation.state === 'acknowledged' ? 'secondary' : needsPerson ? 'destructive' : 'outline'
  const known = obligation.lastError ? KNOWN_OBLIGATION_ERRORS[obligation.lastError] : undefined

  return (
    <div className="border-border mt-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-sm font-medium">
          {t.has(`obligation.authorities.${obligation.authority}`)
            ? t(`obligation.authorities.${obligation.authority}`)
            : obligation.authority}
        </p>
        <Badge variant={variant} className="gap-1">
          {obligation.state === 'acknowledged' && (
            <CheckCircle2Icon className="size-3 text-[color:var(--bo-success-500)]" aria-hidden />
          )}
          {t(`obligation.states.${obligation.state}`)}
        </Badge>
      </div>

      <dl className="text-muted-foreground mt-2 grid gap-1 text-xs">
        <div className="flex justify-between gap-4">
          <dt>{t('obligation.deadline')}</dt>
          <dd className="num">{when}</dd>
        </div>
        {obligation.alertRung > 0 && obligation.state !== 'acknowledged' && (
          // How far up the alert ladder it has gone (WP1.5). The level, not a
          // delivery receipt: a rung with no number on record still counts.
          <div className="flex justify-between gap-4">
            <dt>{t('obligation.alerted')}</dt>
            <dd>{t(`obligation.reaches.${ALERT_REACHES[obligation.alertRung - 1]}`)}</dd>
          </div>
        )}
        {obligation.attempts > 0 && (
          <div className="flex justify-between gap-4">
            <dt>{t('obligation.attempts')}</dt>
            <dd className="num">{obligation.attempts}</dd>
          </div>
        )}
        {obligation.evidence && (
          <div className="flex justify-between gap-4">
            <dt>
              {obligation.evidence.source === 'manual'
                ? t('obligation.evidenceManual')
                : t('obligation.evidence')}
            </dt>
            {/* The receipt's hash: what an inspector compares against. */}
            <dd className="num truncate">{obligation.evidence.hash.slice(0, 16)}…</dd>
          </div>
        )}
      </dl>

      {obligation.lastError && obligation.state !== 'acknowledged' && (
        <p className={`mt-2 text-xs ${needsPerson ? 'text-destructive' : 'text-muted-foreground'}`}>
          {known ? t(`obligation.errors.${known}`) : obligation.lastError}
        </p>
      )}

      {fallback && (
        <div className="border-border mt-3 rounded-md border border-dashed p-3">
          <p className="text-foreground text-sm font-medium">{t('obligation.fallbackTitle')}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t('obligation.fallbackHint')}</p>
          <ol className="text-foreground mt-2 list-decimal space-y-1 pl-5 text-xs" lang="it">
            {fallback.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Button asChild size="sm" variant="outline" className="mt-3">
            {/* A plain anchor: it downloads a file, it does not navigate. */}
            <a href={fallback.href} download>
              <DownloadIcon className="size-4" aria-hidden />
              {t('obligation.fallbackDownload')}
            </a>
          </Button>
          {retry && (
            // After an outage, before filing by hand: one more attempt through
            // the channel, whose receipt then becomes the evidence.
            <form action={retry} className="mt-3">
              <input type="hidden" name="obligationId" value={obligation.id} />
              <PendingButton size="sm" variant="ghost">
                {t('obligation.retryChannel')}
              </PendingButton>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('obligation.retryChannelHint')}
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
