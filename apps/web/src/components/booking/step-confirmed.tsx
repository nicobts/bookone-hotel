import { getTranslations } from 'next-intl/server'
import type { BookingProperty, HeldBooking } from '@bookone/core/db'
import { formatDate, formatMoney, roomName } from './format'

/**
 * The confirmation screen (E1.2).
 *
 * The reference is the largest thing on it. That string is what a guest reads
 * out on the phone, quotes in an email and shows at the desk — everything else
 * here they can look up again, and this is the one thing they cannot.
 *
 * The email address is echoed back on purpose: a typo caught on this screen
 * costs the guest ten seconds, and a typo caught three days later costs the
 * property a phone call about a confirmation that never arrived.
 */
export async function StepConfirmed({
  property,
  booking,
  locale,
}: {
  property: BookingProperty
  booking: HeldBooking
  locale: string
}) {
  const t = await getTranslations('booking.confirmed')

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {t('subtitle', { property: property.name })}
      </p>

      <div className="border-border mt-8 rounded-lg border px-5 py-4">
        <p className="text-muted-foreground text-xs">{t('reference')}</p>
        <p className="text-foreground mt-1 font-mono text-3xl font-semibold tracking-wider">
          {booking.reference}
        </p>
      </div>

      <dl className="mt-6 grid gap-2 text-sm">
        <div className="flex justify-between gap-6">
          <dt className="text-muted-foreground">
            {formatDate(booking.arrivalDate, locale)} → {formatDate(booking.departureDate, locale)}
          </dt>
          <dd className="text-foreground">
            {roomName(booking.roomNameI18n, locale, booking.roomCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-muted-foreground">&nbsp;</dt>
          <dd className="text-foreground tabular-nums">
            {formatMoney(booking.totalCents, booking.currency, locale)}
          </dd>
        </div>
      </dl>

      {booking.guestEmail && (
        <p className="text-muted-foreground mt-6 text-sm">
          {t('emailSent', { email: booking.guestEmail })}
        </p>
      )}

      <p className="text-muted-foreground mt-2 text-sm">{t('next')}</p>
    </div>
  )
}
