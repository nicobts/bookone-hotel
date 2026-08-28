import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getBookingProperty, getHeldBooking } from '@bookone/core/db'
import { BookingShell } from '@/components/booking/booking-shell'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDate, formatMoney, roomName } from '@/components/booking/format'
import { cancellationQuote } from '@/lib/worker'
import { cancel } from '../../actions'

/**
 * Manage a booking — self-service cancellation (E1.4).
 *
 * Reached from the link in the confirmation email. The reservation UUID is the
 * credential: unguessable, scoped to one booking, and the same trust model the
 * confirmation screen already uses. A signed short-lived token is the Sprint 5
 * upgrade, and it arrives with `/stay/[token]` rather than being invented twice.
 *
 * The acceptance criterion this page exists to meet is one line long and drives
 * the whole layout: **the refund is computed and shown before confirm**. So the
 * amount is the largest thing on the cancel panel, the rule that produced it is
 * stated underneath, and the button says what it does. A cancel flow that
 * reveals what it kept afterwards is the fastest way to turn a routine
 * cancellation into a chargeback.
 */
export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; property: string; reservation: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, property: slug, reservation: reservationId } = await params
  setRequestLocale(locale)

  const query = await searchParams

  const property = await getBookingProperty(slug)
  if (!property) notFound()

  const booking = await getHeldBooking(property.id, reservationId)
  if (!booking) notFound()

  const t = await getTranslations('booking')

  const cancelled = single(query.cancelled) === '1' || booking.status === 'cancelled'
  const refundFailed = single(query.refund) === 'failed'

  // Only asked for when it could matter. A confirmed booking needs the number;
  // a cancelled one does not, and the call is a round trip to another process.
  const quote =
    booking.status === 'confirmed'
      ? await cancellationQuote({
          propertyId: property.id,
          reservationId,
        })
      : null

  return (
    <BookingShell property={property} step={null}>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('manage.title')}</h1>

      <div className="border-border mt-6 rounded-lg border px-5 py-4">
        <p className="text-muted-foreground text-xs">{t('manage.reference')}</p>
        <p className="text-foreground mt-1 font-mono text-2xl font-semibold tracking-wider">
          {booking.reference}
        </p>
      </div>

      <dl className="mt-6 grid gap-3 text-sm">
        <Row label={t('manage.stay')}>
          {formatDate(booking.arrivalDate, locale)} → {formatDate(booking.departureDate, locale)}
        </Row>
        <Row label={t('manage.room')}>
          {roomName(booking.roomNameI18n, locale, booking.roomCode)}
        </Row>
        <Row label={t('manage.total')}>
          {formatMoney(booking.totalCents, booking.currency, locale)}
        </Row>
        {quote && quote.paidCents > 0 && (
          <Row label={t('manage.paid')}>{formatMoney(quote.paidCents, quote.currency, locale)}</Row>
        )}
        <Row label={t('manage.status')}>
          {cancelled
            ? t('manage.statusCancelled')
            : booking.status === 'confirmed'
              ? t('manage.statusConfirmed')
              : t('manage.statusHold')}
        </Row>
      </dl>

      {cancelled ? (
        <div className="mt-8">
          <p className="text-foreground text-sm font-medium">{t('manage.cancelled')}</p>
          {refundFailed && (
            // Said plainly rather than hidden. The guest's money did not come
            // back automatically, and finding that out from their bank a week
            // later is far worse than reading it here.
            <p role="alert" className="text-destructive mt-2 text-sm">
              {t('manage.refundFailed')}
            </p>
          )}
        </div>
      ) : quote && quote.cancellable ? (
        <>
          <Separator className="my-8" />

          <h2 className="text-foreground font-medium">{t('manage.cancelHeading')}</h2>

          {/*
            The number first, then the rule that produced it. E1.4 requires the
            refund to be computed and shown before confirm, and "shown" means
            legible at a glance, not present somewhere on the page.
          */}
          {quote.refundCents > 0 ? (
            <div className="mt-3">
              <p className="text-muted-foreground text-xs">{t('manage.refundNow')}</p>
              <p className="text-foreground text-2xl font-semibold tabular-nums">
                {formatMoney(quote.refundCents, quote.currency, locale)}
              </p>
            </div>
          ) : (
            <p className="text-foreground mt-3 text-sm">
              {quote.paidCents === 0 ? t('manage.refundAll') : t('manage.refundNone')}
            </p>
          )}

          <p className="text-muted-foreground mt-2 text-xs">
            {quote.appliedWindow
              ? t('manage.window', { hours: quote.appliedWindow.hoursBeforeArrival })
              : quote.refundPercent === 100
                ? t('manage.refundAll')
                : t('manage.pastWindow')}
          </p>

          {single(query.error) === 'cancel' && (
            <p role="alert" className="text-destructive mt-4 text-sm">
              {t('errors.generic')}
            </p>
          )}

          <form
            action={cancel.bind(null, { locale, slug, reservationId })}
            className="mt-6 flex items-center gap-4"
          >
            {/*
              Nothing about the amount travels in this form. The worker
              recomputes it from the policy and the ledger — a refund figure
              posted from a browser is a refund figure anyone can raise.
            */}
            <Button type="submit" variant="destructive">
              {t('manage.confirmCancel')}
            </Button>
            <a
              href={`/${locale}/book/${slug}`}
              className="text-muted-foreground text-sm underline underline-offset-4"
            >
              {t('manage.keep')}
            </a>
          </form>
        </>
      ) : (
        <p className="text-muted-foreground mt-8 text-sm">{t('manage.notCancellable')}</p>
      )}
    </BookingShell>
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

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
