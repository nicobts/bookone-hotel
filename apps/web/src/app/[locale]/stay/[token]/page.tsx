import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, CircleIcon, InfoIcon } from 'lucide-react'
import { hasDocumentConsent, resolveStay } from '@bookone/core/journey'
import { getThreadForReservation, listMessages, listStayTasks } from '@bookone/core/concierge'
import { getCheckoutSummary } from '@bookone/core/stay'
import { BookingShell } from '@/components/booking/booking-shell'
import { formatDate, formatMoney, roomName } from '@/components/booking/format'
import { SimulatedPaymentNotice } from '@/components/booking/payment-notice'
import { Thread } from '@/components/stay/thread'
import { hasFeature } from '@/lib/auth/current-property'
import { DOCUMENT_RETENTION_DAYS_DEFAULT } from '@bookone/core/alloggiati'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { Input } from '@bookone/ui/components/input'
import { Label } from '@bookone/ui/components/label'
import { Separator } from '@bookone/ui/components/separator'
import { Textarea } from '@bookone/ui/components/textarea'
import {
  checkOut,
  confirmArrivalNow,
  sendMessage,
  submitArrivalTime,
  submitParty,
  uploadDocument,
} from './actions'

/**
 * Guest journey surface — pre-arrival (PRD B1, E2.1, E2.2).
 *
 * Reached by a signed token, resolved server-side. Guests never hold a Supabase
 * session (ADR-007), and arrival *completion* can only be triggered from a
 * reservation-scoped source (E3.1) — this page states an expected time, which
 * is a different thing.
 *
 * ## Everything on one page, and that is the design
 *
 * E2.1 asks for a five-minute median with document photos, on a phone. A wizard
 * would be the obvious shape and the wrong one: it hides how much is left,
 * makes going back to fix a typo a navigation problem, and turns every
 * interruption into a lost position. This is one page with three sections, each
 * saving independently, showing what is done and what is not.
 *
 * That also makes it genuinely resumable — the acceptance criterion — without a
 * session to lose. A guest who closes the tab on hotel wifi and opens the link
 * again the next morning sees exactly what they left.
 */
export default async function StayPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  setRequestLocale(locale)

  const t = await getTranslations('stay')

  const resolved = await resolveStay(token)

  if (!resolved.ok) {
    // Every failure gets its own sentence. "This link is not valid" and "this
    // link has expired" send a guest to different places — the second one has a
    // property who can send them a new one, and telling them so is the
    // difference between a fixed problem and a phone call.
    const message =
      resolved.reason === 'expired-token'
        ? t('errors.expiredToken')
        : resolved.reason === 'unavailable'
          ? t('errors.unavailable')
          : resolved.reason === 'not-configured'
            ? t('errors.notConfigured')
            : t('errors.invalidToken')

    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <p className="text-foreground text-sm font-medium">{message}</p>
      </main>
    )
  }

  const { stay } = resolved
  const context = { locale, token }

  // The shell wants the property shape the booking surface uses. Built from
  // what the token resolved rather than re-queried: one round trip, and the
  // theming a guest saw when they booked is the theming they see now.
  const property = {
    id: stay.propertyId,
    slug: stay.propertySlug,
    name: stay.propertyName,
    languages: [locale],
    localeDefault: stay.propertyLocale,
    timezone: 'Europe/Rome',
    theme: readTheme(stay.propertySettings),
    contact: {},
    settings: stay.propertySettings,
  }

  const partySize = Math.max(1, stay.adults + stay.children)

  /*
   * Every named guest has a document, not merely somebody.
   *
   * The journey's `documents` dimension is stay-level and says "at least one
   * has arrived" — which is the right granularity for it, because deletion and
   * validation happen to the set. But the property needs one document *per
   * person* to register the party, so telling a guest they are checked in while
   * a companion's passport is still missing produces exactly the desk
   * conversation this feature exists to remove.
   *
   * Found by filling the form in with two guests and one photo.
   */
  const named = stay.party.filter((member) => readString(member.data.fullName).trim().length > 0)

  const everyGuestHasDocument =
    named.length > 0 && named.every((member) => member.hasDocument || member.documentDeleted)

  const complete = stay.outstanding.length === 0 && everyGuestHasDocument

  /*
   * The conversation, what has been asked for, and what is owed.
   *
   * Three reads rather than one, because they answer different questions and a
   * stay that has never been messaged should not pay for a checkout summary it
   * will not render. All three are scoped by the property the token resolved
   * to — the token is the guest's whole authorisation (ADR-007).
   */
  const thread = await getThreadForReservation(stay.propertyId, stay.reservationId)
  const messages = thread ? await listMessages(stay.propertyId, thread.id) : []
  const tasks = await listStayTasks(stay.propertyId, stay.reservationId)
  const checkout =
    stay.journey.arrival === 'confirmed'
      ? await getCheckoutSummary(stay.propertyId, stay.reservationId)
      : null

  /*
   * "I have arrived" appears on the day and not before.
   *
   * Confirming two days early would post a check-in and file the party with the
   * police registry while the guest was still on a train. Compared against the
   * property's own date string rather than a timestamp: `arrivalDate` is a
   * calendar day at the property, and converting it to an instant to compare
   * against `now` is how a guest in another timezone loses the button on the
   * morning they need it.
   */
  const arrivalIsToday = stay.arrivalDate <= todayAt(property.timezone)

  // Which parts of the page this property offers (ADR-019). A guest never sees
  // a form whose action would refuse them.
  const prearrival = await hasFeature(stay.propertyId, 'prearrival')
  const inbox = await hasFeature(stay.propertyId, 'inbox')

  // Consent before the first document (WP0.4), and the retention promise that
  // matches what will actually happen: deletion on filing when the property
  // files through BookOne, a set number of days after departure when it does not.
  const consented = prearrival
    ? await hasDocumentConsent(stay.propertyId, stay.reservationId)
    : true
  const filesThroughUs = await hasFeature(stay.propertyId, 'alloggiati')
  const retentionDays = readRetentionDays(stay.propertySettings)

  return (
    <BookingShell property={property} step={null}>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {t('subtitle', {
          property: stay.propertyName,
          arrival: formatDate(stay.arrivalDate, locale),
        })}
      </p>

      <div className="bg-muted/40 mt-6 rounded-lg px-4 py-3 text-sm">
        <p className="text-muted-foreground text-xs">{t('reference')}</p>
        <p className="text-foreground font-mono text-lg font-semibold tracking-wider">
          {stay.reference}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {roomName(stay.roomName, locale, stay.roomCode)}
        </p>
      </div>

      {prearrival &&
        (complete ? (
          <div className="mt-8">
            <h2 className="text-foreground font-medium">{t('complete.heading')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('complete.body', { property: stay.propertyName })}
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mt-6 text-sm">{t('minutes')}</p>

            {/*
            What is left, before the forms. A guest who can see three short
            items starts; a guest facing an undifferentiated wall of fields
            estimates it at twenty minutes and does it at the desk.
          */}
            <ul className="mt-4 space-y-1.5 text-sm">
              <Task
                done={stay.journey.precheckin === 'submitted'}
                label={t('outstanding.details')}
              />
              <Task done={everyGuestHasDocument} label={t('outstanding.documents')} />
              <Task done={stay.journey.arrival !== 'pending'} label={t('outstanding.arrival')} />
            </ul>
          </>
        ))}

      <Separator className="my-8" />

      {/* Pre-arrival capture — its own feature (ADR-019). */}
      {prearrival && (
        <>
          {/* ------------------------------------------------------------- party */}
          <section>
            <h2 className="text-foreground font-medium">{t('party.heading')}</h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('party.hint')}</p>
            <p className="text-muted-foreground mt-1 text-xs">{t('party.required')}</p>

            <form action={submitParty.bind(null, context)} className="mt-5 space-y-6">
              {Array.from({ length: partySize }, (_, index) => {
                const member = stay.party.find((entry) => entry.guestIndex === index)
                const prefilled =
                  index === 0 ? splitName(stay.leadGuestName) : { surname: '', givenName: '' }

                return (
                  <fieldset key={index} className="space-y-3">
                    <legend className="text-muted-foreground text-xs font-medium">
                      {index === 0 ? t('party.lead') : t('party.guest', { n: index + 1 })}
                    </legend>

                    {/*
                  Surname and given name separately, because the registry files
                  them separately (E2.3) — and splitting a free-text full name
                  is a guess that gets Spanish and Hungarian names wrong.
                */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor={`surname-${index}`}>{t('party.surname')}</Label>
                        <Input
                          id={`surname-${index}`}
                          name={`surname-${index}`}
                          autoComplete={index === 0 ? 'family-name' : 'off'}
                          defaultValue={readString(member?.data.surname) || prefilled.surname}
                          required={index === 0}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`given-${index}`}>{t('party.givenName')}</Label>
                        <Input
                          id={`given-${index}`}
                          name={`given-${index}`}
                          autoComplete={index === 0 ? 'given-name' : 'off'}
                          defaultValue={readString(member?.data.givenName) || prefilled.givenName}
                          required={index === 0}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor={`sex-${index}`}>{t('party.sex')}</Label>
                        <select
                          id={`sex-${index}`}
                          name={`sex-${index}`}
                          defaultValue={readString(member?.data.sex)}
                          className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                        >
                          <option value="">—</option>
                          <option value="m">{t('party.male')}</option>
                          <option value="f">{t('party.female')}</option>
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`birth-${index}`}>{t('party.birthDate')}</Label>
                        <Input
                          id={`birth-${index}`}
                          name={`birth-${index}`}
                          type="date"
                          defaultValue={readString(member?.data.birthDate)}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor={`birthPlace-${index}`}>{t('party.birthPlace')}</Label>
                        <Input
                          id={`birthPlace-${index}`}
                          name={`birthPlace-${index}`}
                          defaultValue={readString(member?.data.birthPlace)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`birthCountry-${index}`}>{t('party.birthCountry')}</Label>
                        <Input
                          id={`birthCountry-${index}`}
                          name={`birthCountry-${index}`}
                          maxLength={2}
                          placeholder="IT"
                          defaultValue={readString(member?.data.birthCountry)}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor={`citizenship-${index}`}>{t('party.citizenship')}</Label>
                      <Input
                        id={`citizenship-${index}`}
                        name={`citizenship-${index}`}
                        maxLength={2}
                        placeholder="IT"
                        defaultValue={readString(member?.data.citizenship)}
                      />
                      <p className="text-muted-foreground text-xs">{t('party.countryHint')}</p>
                    </div>

                    {/* For the ISTAT return, not the police (ADR-045). */}
                    <div className="grid gap-2">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor={`residenceCountry-${index}`}>
                            {t('party.residenceCountry')}
                          </Label>
                          <Input
                            id={`residenceCountry-${index}`}
                            name={`residenceCountry-${index}`}
                            maxLength={2}
                            placeholder="IT"
                            defaultValue={readString(member?.data.residenceCountry)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`residenceProvince-${index}`}>
                            {t('party.residenceProvince')}
                          </Label>
                          <Input
                            id={`residenceProvince-${index}`}
                            name={`residenceProvince-${index}`}
                            maxLength={2}
                            placeholder="TS"
                            defaultValue={readString(member?.data.residenceProvince)}
                          />
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs">{t('party.residenceHint')}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor={`docType-${index}`}>{t('party.documentType')}</Label>
                        <select
                          id={`docType-${index}`}
                          name={`docType-${index}`}
                          defaultValue={readString(member?.data.documentType)}
                          className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                        >
                          <option value="">—</option>
                          <option value="passport">{t('party.passport')}</option>
                          <option value="idCard">{t('party.idCard')}</option>
                          <option value="drivingLicence">{t('party.drivingLicence')}</option>
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`docNumber-${index}`}>{t('party.documentNumber')}</Label>
                        <Input
                          id={`docNumber-${index}`}
                          name={`docNumber-${index}`}
                          defaultValue={readString(member?.data.documentNumber)}
                        />
                      </div>
                    </div>
                  </fieldset>
                )
              })}

              <PendingButton>{t('party.save')}</PendingButton>
            </form>
          </section>

          <Separator className="my-8" />

          {/* --------------------------------------------------------- documents */}
          <section>
            <h2 className="text-foreground font-medium">{t('documents.heading')}</h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('documents.hint')}</p>

            {/*
              How the data is used, above the upload rather than behind a link:
              the guest is about to photograph a passport. DRAFT wording — it
              states the product's actual behaviour (ADR-027, ADR-029, the data
              map) and must be reviewed by the property's counsel before a real
              guest reads it.
            */}
            <details className="bg-muted/40 mt-4 rounded-lg px-4 py-3 text-xs" open={!consented}>
              <summary className="text-foreground cursor-pointer font-medium">
                {t('privacy.heading')}
              </summary>
              <div className="text-muted-foreground mt-2 space-y-1.5">
                <p>{t('privacy.controller', { property: stay.propertyName })}</p>
                <p>{t('privacy.purpose')}</p>
                <p>{t('privacy.retention')}</p>
                <p>{t('privacy.location')}</p>
                <p>{t('privacy.rights')}</p>
              </div>
            </details>

            {stay.party.length === 0 ? (
              // Deliberately not a disabled upload field. The reason it is not
              // available is that we do not yet know who the document belongs to,
              // and saying that is more useful than greying something out.
              <p className="text-muted-foreground mt-4 text-sm">{t('documents.needParty')}</p>
            ) : (
              <div className="mt-5 space-y-4">
                {stay.party.map((member) => (
                  <form
                    key={member.guestIndex}
                    action={uploadDocument.bind(null, context)}
                    className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end sm:justify-between"
                  >
                    <input type="hidden" name="guestIndex" value={member.guestIndex} />

                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-sm font-medium">
                        {t('documents.for', { name: readString(member.data.fullName) })}
                      </p>

                      {member.documentDeleted ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {t('documents.deleted')}
                        </p>
                      ) : isUnreadable(member.data) ? (
                        // The machine-readable zone did not check out (WP0.4):
                        // ask for another photo now, not at the desk.
                        <p role="alert" className="text-destructive mt-1 text-xs">
                          {t('documents.unreadable')}
                        </p>
                      ) : member.hasDocument ? (
                        <p className="mt-1 text-xs text-[color:var(--bo-success-500)]">
                          {t('documents.uploaded')}
                        </p>
                      ) : null}

                      {!member.documentDeleted && (
                        <Input
                          type="file"
                          name="document"
                          required
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          // `capture` opens the camera on a phone rather than a
                          // file browser. The guest is holding the document.
                          capture="environment"
                          className="mt-3"
                        />
                      )}

                      {!member.documentDeleted && !consented && (
                        <label className="text-muted-foreground mt-3 flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            name="consent"
                            required
                            className="mt-0.5 accent-current"
                          />
                          <span>{t('documents.consent')}</span>
                        </label>
                      )}
                    </div>

                    {!member.documentDeleted && (
                      <PendingButton variant="outline">
                        {member.hasDocument ? t('documents.replace') : t('documents.send')}
                      </PendingButton>
                    )}
                  </form>
                ))}
              </div>
            )}

            {/*
          The retention promise, next to the upload rather than in a policy page.
          Somebody is about to photograph their passport for a company they have
          never heard of; what happens to it afterwards is the question they are
          actually asking (E2.4).
        */}
            <p className="text-muted-foreground mt-4 text-xs">
              {filesThroughUs
                ? t('documents.retention')
                : t('documents.retentionAfterStay', { days: retentionDays })}
            </p>
          </section>

          <Separator className="my-8" />

          {/* ----------------------------------------------------------- arrival */}
          <section>
            <h2 className="text-foreground font-medium">{t('arrival.heading')}</h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('arrival.hint')}</p>

            <form
              action={submitArrivalTime.bind(null, context)}
              className="mt-5 flex flex-wrap items-end gap-3"
            >
              <div className="grid gap-2">
                <Label htmlFor="time">{t('arrival.time')}</Label>
                <Input
                  id="time"
                  name="time"
                  type="time"
                  required
                  defaultValue={stay.journey.expectedArrivalTime ?? ''}
                />
              </div>
              <PendingButton variant="outline">{t('arrival.save')}</PendingButton>
            </form>

            {stay.journey.expectedArrivalTime && (
              <p className="text-muted-foreground mt-3 text-sm">
                {t('arrival.saved', { time: stay.journey.expectedArrivalTime })}
              </p>
            )}
          </section>

          <Separator className="my-8" />
        </>
      )}

      {/* ----------------------------------------------------------- arrival */}
      {arrivalIsToday && stay.journey.arrival !== 'confirmed' && (
        <section>
          <h2 className="text-foreground font-medium">{t('arrived.heading')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('arrived.body')}</p>

          <form action={confirmArrivalNow.bind(null, context)} className="mt-4">
            <PendingButton>{t('arrived.action')}</PendingButton>
          </form>
        </section>
      )}

      {stay.journey.arrival === 'confirmed' && (
        <section>
          <h2 className="text-foreground font-medium">{t('arrived.done')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('arrived.doneBody', { property: stay.propertyName })}
          </p>
        </section>
      )}

      {/* Messaging — the inbox feature (ADR-019). */}
      {inbox && (
        <>
          <Separator className="my-8" />

          {/* ---------------------------------------------------------- messages */}
          <section id="messages">
            <h2 className="text-foreground font-medium">{t('messages.heading')}</h2>
            <p className="text-muted-foreground mt-1 text-xs">{t('messages.hint')}</p>

            <Thread messages={messages} locale={locale} />

            {tasks.length > 0 && (
              <div className="mt-5">
                <h3 className="text-muted-foreground bo-label mb-2">{t('messages.requests')}</h3>
                <ul className="space-y-1.5 text-sm">
                  {tasks.map((task) => (
                    <li key={task.id} className="flex items-start justify-between gap-3">
                      <span className="text-foreground">{task.summary}</span>
                      {/*
                    "Recorded" and "done", never "on its way". A guest told a
                    thing is handled stops chasing it; a guest told it is
                    written down knows to ask again if nothing happens.
                  */}
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {task.status === 'done' ? t('messages.taskDone') : t('messages.taskOpen')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <form action={sendMessage.bind(null, context)} className="mt-5 flex flex-col gap-2">
              <Label htmlFor="message" className="sr-only">
                {t('messages.label')}
              </Label>
              <Textarea
                id="message"
                name="message"
                rows={3}
                required
                maxLength={4000}
                placeholder={t('messages.placeholder')}
              />
              <div className="flex items-center justify-between gap-3">
                {/*
              An explicit request affordance, because intent stated by the
              person beats intent inferred from their words — and the inference
              is a word list that will be wrong about somebody's phrasing
              (packages/core/src/concierge/intent.ts).
            */}
                <label className="text-muted-foreground flex items-center gap-2 text-xs">
                  <input type="checkbox" name="intent" value="request" className="accent-current" />
                  {t('messages.isRequest')}
                </label>
                <PendingButton size="sm">{t('messages.send')}</PendingButton>
              </div>
            </form>
          </section>
        </>
      )}

      {/* ---------------------------------------------------------- checkout */}
      {checkout && stay.journey.arrival === 'confirmed' && (
        <>
          <Separator className="my-8" />

          <section id="checkout">
            <h2 className="text-foreground font-medium">{t('checkout.heading')}</h2>

            {checkout.departure === 'pending' ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {t('checkout.body', {
                  departure: formatDate(checkout.departureDate, locale),
                })}
              </p>
            ) : (
              <p className="text-muted-foreground mt-1 text-sm">{t('checkout.done')}</p>
            )}

            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{t('checkout.paid')}</dt>
                <dd className="num text-foreground font-medium">
                  {formatMoney(checkout.paidCents, checkout.currency, locale)}
                </dd>
              </div>

              {checkout.lines.map((line) => (
                <div key={line.id} className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{line.description}</dt>
                  <dd className="num text-foreground">
                    {formatMoney(line.amountCents, line.currency, locale)}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              The partial view, stated rather than implied (E4.1).

              We do not hold the folio: the minibar, the restaurant and the spa
              live in the property's PMS. A total that silently omitted them
              would be confidently short, and the guest would find out at the
              desk they were trying to walk past.
            */}
            {checkout.partialView && (
              <p className="text-muted-foreground mt-4 flex items-start gap-2 text-xs">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t('checkout.partial')}
              </p>
            )}

            <SimulatedPaymentNotice className="mt-4" />

            {checkout.departure === 'pending' && (
              <form action={checkOut.bind(null, context)} className="mt-6 space-y-4">
                <fieldset className="space-y-3">
                  <legend className="text-muted-foreground text-xs font-medium">
                    {t('checkout.invoice.heading')}
                  </legend>
                  {/*
                    A request, not a document. We assign no number, generate
                    nothing and transmit nothing to any authority — the property
                    issues the fattura through their own certified chain
                    (D11, binding rule 6).
                  */}
                  <p className="text-muted-foreground text-xs">{t('checkout.invoice.hint')}</p>

                  <div className="space-y-1.5">
                    <Label htmlFor="billTo">{t('checkout.invoice.billTo')}</Label>
                    <Input id="billTo" name="billTo" autoComplete="organization" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="taxId">{t('checkout.invoice.taxId')}</Label>
                    <Input id="taxId" name="taxId" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="address">{t('checkout.invoice.address')}</Label>
                    <Input id="address" name="address" autoComplete="street-address" />
                  </div>
                </fieldset>

                <PendingButton>{t('checkout.action')}</PendingButton>
              </form>
            )}

            {checkout.invoiceRequested && (
              <p className="text-muted-foreground mt-4 text-xs">{t('checkout.invoice.sent')}</p>
            )}
          </section>
        </>
      )}
    </BookingShell>
  )
}

async function Task({ done, label }: { done: boolean; label: string }) {
  const t = await getTranslations('stay')

  return (
    <li className="flex items-center gap-2">
      {done ? (
        <CheckCircle2Icon
          className="size-4 shrink-0 text-[color:var(--bo-success-500)]"
          aria-hidden
        />
      ) : (
        <CircleIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      )}
      <span className={done ? 'text-muted-foreground line-through' : 'text-foreground'}>
        {label}
      </span>
      {done && <span className="sr-only">{t('done')}</span>}
    </li>
  )
}

/**
 * A best-effort split of the name captured at booking.
 *
 * Only ever a *prefill* — the guest sees both fields and corrects them. The
 * last word is treated as the surname, which is right for German and Italian
 * and wrong for plenty of names, and that is exactly why the split is never
 * stored: what the guest confirms is what gets filed.
 */
function splitName(full: string | null): { surname: string; givenName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)

  if (parts.length === 0) return { surname: '', givenName: '' }
  if (parts.length === 1) return { surname: parts[0]!, givenName: '' }

  return { surname: parts[parts.length - 1]!, givenName: parts.slice(0, -1).join(' ') }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readTheme(settings: unknown): { primary?: string; accent?: string } {
  if (settings === null || typeof settings !== 'object') return {}

  const theme = (settings as Record<string, unknown>).theme
  if (theme === null || typeof theme !== 'object') return {}

  const record = theme as Record<string, unknown>

  return {
    ...(typeof record.primary === 'string' ? { primary: record.primary } : {}),
    ...(typeof record.accent === 'string' ? { accent: record.accent } : {}),
  }
}

/**
 * Today, as the property would write it.
 *
 * `en-CA` because it formats as `YYYY-MM-DD`, which is what the reservation
 * stores — a locale used as a formatter rather than as a language, which is
 * worth saying out loud so nobody "fixes" it to the guest's locale and gets
 * `03/09/2026` compared against `2026-09-03`.
 */
function todayAt(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

/** The property's document retention after departure, or the default (WP0.4). */
function readRetentionDays(settings: unknown): number {
  const value =
    settings !== null && typeof settings === 'object'
      ? (settings as Record<string, unknown>).documentRetentionDays
      : undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : DOCUMENT_RETENTION_DAYS_DEFAULT
}

/** The document was read and its machine-readable zone failed its check digits (WP0.4). */
function isUnreadable(data: Record<string, unknown>): boolean {
  const ocr = data.ocr as { mrz?: { present?: boolean; valid?: boolean } } | undefined
  return Boolean(ocr?.mrz?.present && !ocr.mrz.valid)
}
