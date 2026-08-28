import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getBookingProperty, getHeldBooking } from '@bookone/core/db'
import { readTouristTaxPolicy, searchAvailability, touristTaxNote } from '@bookone/core/booking'
import { BookingShell } from '@/components/booking/booking-shell'
import { StaleFallback } from '@/components/booking/stale-fallback'
import { StepConfirmed } from '@/components/booking/step-confirmed'
import { StepDates } from '@/components/booking/step-dates'
import { StepDetails } from '@/components/booking/step-details'
import { StepReview } from '@/components/booking/step-review'
import { StepRooms } from '@/components/booking/step-rooms'
import { readDraft } from '@/lib/booking/draft'
import { parseSearch, searchToQuery } from '@/lib/booking/params'
import { confirm, saveDetails, selectRoom, sendRequest } from './actions'

/**
 * Guest booking surface — public, per property, themed (PRD A1–A3).
 *
 * First platform-authoritative domain (D12): a reservation is born here with
 * its own UUID and `origin='platform'` before any external call, then reflects
 * to the PMS through the adapter. Availability is read-only display from
 * `rate_snapshots`, every price carries the snapshots it came from, and a stale
 * source produces a request form rather than a guess.
 *
 * Four steps, no account, state in the URL. The reference implementation and
 * every deviation from it are recorded in docs/design-notes/booking-flow.md,
 * which ADR-014 requires to exist before this file does.
 *
 * ## Which step renders
 *
 * Read off the URL, in order of specificity: a confirmed booking, then a hold
 * (details, or review once details are in), then a search, then the empty
 * state. No step is reachable without the state the one before it produces,
 * which is what lets the whole flow survive a refresh, a back button and a
 * forwarded link.
 */
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; property: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const query = await searchParams

  // 404 covers both an unknown slug and a property whose PMS is authoritative
  // for booking — in the second case there is no engine to offer, and it is
  // also the only answer that does not confirm whether a guessed slug exists.
  const property = await getBookingProperty(slug)
  if (!property) notFound()

  const t = await getTranslations('booking')
  const context = { locale, slug }
  const error = single(query.error)

  // ---------------------------------------------------------------- confirmed
  const booked = single(query.booked)
  if (booked) {
    const booking = await getHeldBooking(property.id, booked)
    if (!booking || booking.status !== 'confirmed') notFound()

    return (
      <BookingShell property={property} step={null}>
        <StepConfirmed property={property} booking={booking} locale={locale} />
      </BookingShell>
    )
  }

  const parsed = parseSearch(query)

  // ------------------------------------------------------------------- step 1
  if (parsed.kind !== 'search') {
    return (
      <BookingShell property={property} step={1}>
        <StepDates action={`/${locale}/book/${slug}`} invalid={parsed.kind === 'invalid'} />
      </BookingShell>
    )
  }

  const { search } = parsed
  const baseQuery = searchToQuery(search)

  // -------------------------------------------------------------- steps 3 & 4
  const holdId = single(query.hold)
  if (holdId) {
    const booking = await getHeldBooking(property.id, holdId)

    // A hold that is gone, cancelled or expired sends the guest back to the
    // room list rather than to an error. The dates are still good and the list
    // is still one click from a booking.
    if (!booking || booking.status !== 'hold') {
      return (
        <BookingShell property={property} step={2}>
          <ExpiredHold locale={locale} slug={slug} query={baseQuery} />
        </BookingShell>
      )
    }

    const draft = await readDraft(holdId)
    const wantsReview = single(query.step) === 'review'

    if (wantsReview && draft) {
      const policy = readTouristTaxPolicy(property.settings)
      const nights = countNights(booking.arrivalDate, booking.departureDate)

      return (
        <BookingShell property={property} step={4}>
          <StepReview
            property={property}
            booking={booking}
            draft={draft}
            locale={locale}
            touristTax={
              policy
                ? touristTaxNote(policy, {
                    nightCount: nights,
                    adults: booking.adults,
                    children: booking.children,
                  })
                : null
            }
            action={confirm.bind(null, context)}
            state={{ ...search, hold: holdId }}
            backHref={`/${locale}/book/${slug}?${searchToQuery(search, { hold: holdId })}`}
            {...(error === 'expired'
              ? { error: t('review.expired') }
              : error === 'confirm'
                ? { error: t('errors.generic') }
                : {})}
          />
        </BookingShell>
      )
    }

    return (
      <BookingShell property={property} step={3}>
        <StepDetails
          booking={booking}
          locale={locale}
          draft={draft}
          action={saveDetails.bind(null, context)}
          state={{ ...search, hold: holdId }}
          backHref={`/${locale}/book/${slug}?${baseQuery}`}
          {...(error === 'details' ? { error: t('errors.generic') } : {})}
        />
      </BookingShell>
    )
  }

  // ------------------------------------------------------------------- step 2
  const outcome = await searchAvailability({
    propertyId: property.id,
    arrival: search.arrival,
    departure: search.departure,
    adults: search.adults,
    children: search.children,
  })

  if (outcome.status === 'invalid') {
    return (
      <BookingShell property={property} step={1}>
        <StepDates action={`/${locale}/book/${slug}`} defaults={search} invalid />
      </BookingShell>
    )
  }

  if (outcome.status === 'stale') {
    return (
      <BookingShell property={property} step={2}>
        <StaleFallback
          property={property}
          search={search}
          action={sendRequest.bind(null, context)}
          sent={single(query.requested) === '1'}
          {...(error === 'no-contact' ? { error: t('stale.noContact') } : {})}
        />
      </BookingShell>
    )
  }

  return (
    <BookingShell property={property} step={2}>
      <StepRooms
        options={outcome.options}
        search={search}
        nightCount={outcome.nightCount}
        locale={locale}
        selectAction={selectRoom.bind(null, context)}
        changeHref={`/${locale}/book/${slug}`}
      />
    </BookingShell>
  )
}

async function ExpiredHold({
  locale,
  slug,
  query,
}: {
  locale: string
  slug: string
  query: string
}) {
  const t = await getTranslations('booking.review')

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('expired')}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">{t('expiredHint')}</p>
      <p className="mt-6 text-sm">
        <a
          href={`/${locale}/book/${slug}?${query}`}
          className="text-[color:var(--bo-primary)] underline underline-offset-4"
        >
          {t('back')}
        </a>
      </p>
    </div>
  )
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function countNights(arrival: string, departure: string): number {
  const start = Date.parse(`${arrival}T00:00:00Z`)
  const end = Date.parse(`${departure}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0

  return Math.round((end - start) / 86_400_000)
}
