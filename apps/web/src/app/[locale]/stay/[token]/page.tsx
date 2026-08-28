import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2Icon, CircleIcon } from 'lucide-react'
import { resolveStay } from '@bookone/core/journey'
import { BookingShell } from '@/components/booking/booking-shell'
import { formatDate, roomName } from '@/components/booking/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { submitArrivalTime, submitParty, uploadDocument } from './actions'

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
  searchParams,
}: {
  params: Promise<{ locale: string; token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, token } = await params
  setRequestLocale(locale)

  const query = await searchParams
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
  const error = single(query.error)

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

      {complete ? (
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
            <Task done={stay.journey.precheckin === 'submitted'} label={t('outstanding.details')} />
            <Task done={everyGuestHasDocument} label={t('outstanding.documents')} />
            <Task done={stay.journey.arrival !== 'pending'} label={t('outstanding.arrival')} />
          </ul>
        </>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-6 text-sm">
          {error === 'upload' ? t('errors.upload') : t('errors.generic')}
        </p>
      )}

      <Separator className="my-8" />

      {/* ------------------------------------------------------------- party */}
      <section>
        <h2 className="text-foreground font-medium">{t('party.heading')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('party.hint')}</p>

        <form action={submitParty.bind(null, context)} className="mt-5 space-y-6">
          {Array.from({ length: partySize }, (_, index) => {
            const member = stay.party.find((entry) => entry.guestIndex === index)
            const prefilledName = index === 0 ? (stay.leadGuestName ?? '') : ''

            return (
              <fieldset key={index} className="space-y-3">
                <legend className="text-muted-foreground text-xs font-medium">
                  {index === 0 ? t('party.lead') : t('party.guest', { n: index + 1 })}
                </legend>

                <div className="grid gap-2">
                  <Label htmlFor={`name-${index}`}>{t('party.fullName')}</Label>
                  <Input
                    id={`name-${index}`}
                    name={`name-${index}`}
                    autoComplete={index === 0 ? 'name' : 'off'}
                    defaultValue={readString(member?.data.fullName) || prefilledName}
                    required={index === 0}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor={`birth-${index}`}>{t('party.birthDate')}</Label>
                    <Input
                      id={`birth-${index}`}
                      name={`birth-${index}`}
                      type="date"
                      defaultValue={readString(member?.data.birthDate)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`nationality-${index}`}>{t('party.nationality')}</Label>
                    <Input
                      id={`nationality-${index}`}
                      name={`nationality-${index}`}
                      defaultValue={readString(member?.data.nationality)}
                    />
                  </div>
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
                      <option value="id_card">{t('party.idCard')}</option>
                      <option value="driving_licence">{t('party.drivingLicence')}</option>
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

          <Button type="submit">{t('party.save')}</Button>
        </form>
      </section>

      <Separator className="my-8" />

      {/* --------------------------------------------------------- documents */}
      <section>
        <h2 className="text-foreground font-medium">{t('documents.heading')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('documents.hint')}</p>

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
                    <p className="text-muted-foreground mt-1 text-xs">{t('documents.deleted')}</p>
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
                </div>

                {!member.documentDeleted && (
                  <Button type="submit" variant="outline">
                    {member.hasDocument ? t('documents.replace') : t('documents.send')}
                  </Button>
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
        <p className="text-muted-foreground mt-4 text-xs">{t('documents.retention')}</p>
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
          <Button type="submit" variant="outline">
            {t('arrival.save')}
          </Button>
        </form>

        {stay.journey.expectedArrivalTime && (
          <p className="text-muted-foreground mt-3 text-sm">
            {t('arrival.saved', { time: stay.journey.expectedArrivalTime })}
          </p>
        )}
      </section>
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

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
