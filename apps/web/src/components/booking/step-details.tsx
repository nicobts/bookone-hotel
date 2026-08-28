import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { HeldBooking } from '@bookone/core/db'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BookingDraft } from '@/lib/booking/draft'
import { formatDate, formatMoney, roomName } from './format'
import { StateFields, type BookingState } from './state-fields'

/**
 * Step 3 — identity, asked for last and asked for once (design note §1).
 *
 * Four fields, two of them required, none of them an account. Every field on
 * this screen is a field a guest can leave on, which is why phone is optional
 * and why there is nothing here the property does not need in order to welcome
 * somebody.
 *
 * The chosen room and its total stay on screen throughout. A price that
 * disappears while the guest is typing is a price they stop trusting.
 */
export async function StepDetails({
  booking,
  locale,
  action,
  state,
  backHref,
  draft,
  error,
}: {
  booking: HeldBooking
  locale: string
  action: (formData: FormData) => Promise<void>
  state: BookingState
  backHref: string
  draft: BookingDraft | null
  error?: string
}) {
  const t = await getTranslations('booking')

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        {t('details.title')}
      </h1>
      <p className="text-muted-foreground mt-1.5 text-sm">{t('details.subtitle')}</p>

      <div className="bg-muted/40 mt-6 rounded-lg px-4 py-3 text-sm">
        <p className="text-foreground font-medium">
          {roomName(booking.roomNameI18n, locale, booking.roomCode)}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {formatDate(booking.arrivalDate, locale)} → {formatDate(booking.departureDate, locale)} ·{' '}
          {formatMoney(booking.totalCents, booking.currency, locale)}
        </p>
      </div>

      <form action={action} className="mt-8 grid gap-5">
        <StateFields state={state} />

        <div className="grid gap-2">
          <Label htmlFor="name">{t('details.name')}</Label>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            defaultValue={draft?.name ?? ''}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">{t('details.email')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={draft?.email ?? ''}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="phone">
            {t('details.phone')}{' '}
            <span className="text-muted-foreground font-normal">({t('details.optional')})</span>
          </Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={draft?.phone ?? ''}
          />
        </div>

        <div className="flex items-start gap-3">
          {/* Unchecked, and there is no variant of this screen where it is not.
              A consent that defaults to true is not a consent, and the column
              behind it defaults false for the same reason. */}
          <Checkbox id="marketingConsent" name="marketingConsent" defaultChecked={false} />
          <Label htmlFor="marketingConsent" className="text-muted-foreground font-normal">
            {t('details.marketing')}
          </Label>
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex items-center gap-4">
          <Button type="submit">{t('details.submit')}</Button>
          <Link
            href={backHref}
            className="text-muted-foreground text-sm underline underline-offset-4"
          >
            {t('details.back')}
          </Link>
        </div>
      </form>
    </div>
  )
}
