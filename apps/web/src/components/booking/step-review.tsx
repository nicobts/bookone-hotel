import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { HeldBooking, BookingProperty } from '@bookone/core/db'
import type { TouristTaxNote } from '@bookone/core/booking'
import type { DepositQuote } from '@bookone/core/policy'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { BookingDraft } from '@/lib/booking/draft'
import { formatDate, formatMoney, formatTime, roomName } from './format'
import { StateFields, type BookingState } from './state-fields'
import { SimulatedPaymentNotice } from './payment-notice'

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
  deposit,
  paymentsSimulated,
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
  /** What the property's policy says is due now (E1.3). */
  deposit: DepositQuote
  /**
   * MEMO: true while the payment provider is the mock (ADR-010). Read from the
   * worker rather than an env var here, because the process that would take the
   * money is the one entitled to say whether it is real.
   */
  paymentsSimulated: boolean
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

      {/*
        Payment sits between the itemised total and the commit control — the
        placement both reference implementations use, and the reason they use it
        is that a guest who has read the total and the terms is a guest ready to
        pay (design note §3). The step count does not change.
      */}
      {deposit.dueNowCents > 0 && (
        <section className="mb-6 space-y-4">
          {/* MEMO: disappears on its own once a real provider is connected. */}
          {paymentsSimulated && <SimulatedPaymentNotice />}

          <div className="space-y-1 text-sm">
            <p className="flex items-baseline justify-between">
              <span className="text-foreground font-medium">{t('payment.dueNow')}</span>
              <span className="text-foreground tabular-nums">
                {formatMoney(deposit.dueNowCents, booking.currency, locale)}
              </span>
            </p>
            {deposit.dueAtPropertyCents > 0 && (
              <p className="text-muted-foreground flex items-baseline justify-between text-xs">
                <span>{t('payment.dueAtProperty')}</span>
                <span className="tabular-nums">
                  {formatMoney(deposit.dueAtPropertyCents, booking.currency, locale)}
                </span>
              </p>
            )}
          </div>

          <Separator />
        </section>
      )}

      <ul className="text-muted-foreground space-y-2 text-xs">
        {deposit.dueNowCents === 0 && <li>{t('payment.nothingNow')}</li>}
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
          {deposit.dueNowCents > 0 ? t('payment.payAndConfirm') : t('review.confirm')}
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
