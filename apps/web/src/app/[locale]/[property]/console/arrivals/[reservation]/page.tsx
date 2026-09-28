import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, FlaskConicalIcon, TriangleAlertIcon } from 'lucide-react'
import { getArrival } from '@bookone/core/db'
import { getSchedinaPreview } from '@bookone/core/journey'
import {
  readingMismatches,
  registrationToGuestDetails,
  validateParty,
  type DocumentReading,
} from '@bookone/core/alloggiati'
import { PageShell } from '@/components/shell/page-shell'
import { hasFeature, requireProperty } from '@/lib/auth/current-property'
import { Badge } from '@bookone/ui/components/badge'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { Separator } from '@bookone/ui/components/separator'
import { formatDate } from '@/components/booking/format'
import { confirmDocumentsAction, fileNow, markArrived } from './actions'

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
    ? await getSchedinaPreview(property.id, reservationId)
    : null
  const context = { locale, slug, reservationId }

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
