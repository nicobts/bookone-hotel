import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { HeldBooking, BookingProperty } from '@bookone/core/db'
import type { TouristTaxNote } from '@bookone/core/booking'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { BookingDraft } from '@/lib/booking/draft'
import { formatDate, formatMoney, formatTime, roomName } from './format'
import { StateFields, type BookingState } from './state-fields'

/**
 * Step 4 — the itemised total, the terms, and then the commitment.
 *
 * The order is the references' order and it is the right one: a guest who has
 * read what they are agreeing to is a guest who does not cancel on Tuesday.
 * Sprint 4 inserts payment between the total and the button, which is why there
 * is a separator there and not a margin.
 *
 * What this screen does not do: hurry anybody. No countdown on the price, no
 * scarcity, no "someone else is looking at this room" (design note §4B). The
 * hold expiry is shown because it is true and comes off the row; everything
 * else that would belong in that space is a fact we cannot source.
 */
export async function StepReview({
  property,
  booking,
  draft,
  touristTax,
  locale,
  action,
  state,
  backHref,
  error,
}: {
  property: BookingProperty
  booking: HeldBooking
  draft: BookingDraft
  touristTax: TouristTaxNote | null
  locale: string
  action: (formData: FormData) => Promise<void>
  state: BookingState
  backHref: string
  error?: string
}) {
  const t = await getTranslations('booking')
  const guests = booking.adults + booking.children

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('review.title')}</h1>

      <dl className="mt-8 grid gap-3 text-sm">
        <Row label={t('review.stay')}>
          {formatDate(booking.arrivalDate, locale)} → {formatDate(booking.departureDate, locale)}
        </Row>
        <Row label={t('review.room')}>
          {roomName(booking.roomNameI18n, locale, booking.roomCode)}
        </Row>
        <Row label={t('review.party')}>{t('guests', { count: guests })}</Row>
        <Row label={t('review.name')}>{draft.name}</Row>
        <Row label={t('review.email')}>{draft.email}</Row>
      </dl>

      <Separator className="my-6" />

      <div className="flex items-baseline justify-between">
        <span className="text-foreground font-medium">{t('review.total')}</span>
        <span className="text-foreground text-2xl font-semibold tabular-nums">
          {formatMoney(booking.totalCents, booking.currency, locale)}
        </span>
      </div>

      {/*
        Adjacent to the total and deliberately outside it (design note §4D). In
        IT/AT/SI the property collects this at the point of stay; adding it to
        what is paid online would misstate the charge, and leaving it out
        entirely produces a surprise at the desk.
      */}
      {touristTax && (
        <div className="text-muted-foreground mt-3 space-y-1 text-xs">
          <p className="flex items-baseline justify-between">
            <span>{t('review.touristTax')}</span>
            <span className="tabular-nums">
              {formatMoney(touristTax.estimateCents, touristTax.currency, locale)}
            </span>
          </p>
          {touristTax.cappedAtNights !== null && (
            <p>{t('review.touristTaxCap', { nights: touristTax.cappedAtNights })}</p>
          )}
          {touristTax.childrenExcluded && touristTax.exemptUnderAge !== null && (
            <p>{t('review.touristTaxChildren', { age: touristTax.exemptUnderAge })}</p>
          )}
        </div>
      )}

      <Separator className="my-6" />

      <ul className="text-muted-foreground space-y-2 text-xs">
        <li>{t('review.payment')}</li>
        <li>{t('review.cancellation')}</li>
        {booking.expiresAt && (
          <li>
            {t('review.holdExpires', {
              time: formatTime(booking.expiresAt, locale, property.timezone),
            })}
          </li>
        )}
      </ul>

      {error && (
        <p role="alert" className="text-destructive mt-6 text-sm">
          {error}
        </p>
      )}

      <form action={action} className="mt-8 flex items-center gap-4">
        <StateFields state={state} />
        <Button type="submit" size="lg">
          {t('review.confirm')}
        </Button>
        <Link
          href={backHref}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          {t('review.back')}
        </Link>
      </form>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground text-right">{children}</dd>
    </div>
  )
}
