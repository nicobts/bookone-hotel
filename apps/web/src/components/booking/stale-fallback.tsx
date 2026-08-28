import { getTranslations } from 'next-intl/server'
import type { BookingProperty } from '@bookone/core/db'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BookingSearch } from '@/lib/booking/params'

/**
 * What a guest sees when the availability cache cannot be trusted (E1.1).
 *
 * Three things this is not, each of them a worse alternative that was on the
 * table (design note §4C):
 *
 *   * not the last known price — we would be quoting a number no source stands
 *     behind, to somebody who would be entitled to hold us to it
 *   * not an empty room list — that reads as "no rooms", which is a lie with
 *     the same outcome as a wrong price
 *   * not a silent error page — the guest wants these dates at this hotel, and
 *     a small hotel answering an email is a perfectly good direct booking
 *
 * So: say plainly that we cannot reach live prices, and put the guest in touch
 * with the property. The request lands in the outbox and goes to the hotel in
 * the hotel's own language.
 */
export async function StaleFallback({
  property,
  search,
  action,
  sent = false,
  error,
}: {
  property: BookingProperty
  search: BookingSearch
  action: (formData: FormData) => Promise<void>
  sent?: boolean
  error?: string
}) {
  const t = await getTranslations('booking.stale')

  if (sent) {
    return (
      <div>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('sent')}</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {t('sentBody', { email: property.contact.email ?? '' })}
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">{t('body')}</p>

      {property.contact.phone && (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('callInstead', { phone: property.contact.phone })}
        </p>
      )}

      <form action={action} className="mt-8 grid gap-5">
        {/* The dates the guest already chose travel with the request. Asking
            for them twice is how a fallback becomes the reason somebody leaves. */}
        <input type="hidden" name="arrival" value={search.arrival} />
        <input type="hidden" name="departure" value={search.departure} />
        <input type="hidden" name="adults" value={search.adults} />
        <input type="hidden" name="children" value={search.children} />

        <div className="grid gap-2">
          <Label htmlFor="name">{t('name')}</Label>
          <Input id="name" name="name" autoComplete="name" required />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="phone">{t('phone')}</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="message">{t('message')}</Label>
          <textarea
            id="message"
            name="message"
            rows={3}
            className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          />
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div>
          <Button type="submit">{t('submit')}</Button>
        </div>
      </form>
    </div>
  )
}
