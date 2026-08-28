import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BookingSearch } from '@/lib/booking/params'

/**
 * Step 1 — dates and party, alone (design note §3).
 *
 * A plain GET form, deliberately. The answer belongs in the URL, and a `method`
 * the browser understands means the step works before any JavaScript has loaded
 * — which on a phone, on hotel wifi, is the difference between a booking and a
 * bounce.
 */
export async function StepDates({
  action,
  defaults,
  invalid = false,
}: {
  /** The booking page itself; the form navigates to it with its own params. */
  action: string
  defaults?: BookingSearch
  invalid?: boolean
}) {
  const t = await getTranslations('booking.dates')

  // Today in the property's terms is close enough for a min attribute — it is a
  // convenience on the picker, not the validation. The real check is in
  // `parseSearch` and again in the quote.
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted-foreground mt-1.5 mb-8 text-sm">{t('subtitle')}</p>

      <form method="get" action={action} className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="arrival">{t('arrival')}</Label>
          <Input
            id="arrival"
            name="arrival"
            type="date"
            required
            min={today}
            defaultValue={defaults?.arrival}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="departure">{t('departure')}</Label>
          <Input
            id="departure"
            name="departure"
            type="date"
            required
            min={today}
            defaultValue={defaults?.departure}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="adults">{t('adults')}</Label>
          <Input
            id="adults"
            name="adults"
            type="number"
            min={1}
            max={8}
            required
            defaultValue={defaults?.adults ?? 2}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="children">{t('children')}</Label>
          <Input
            id="children"
            name="children"
            type="number"
            min={0}
            max={8}
            defaultValue={defaults?.children ?? 0}
          />
        </div>

        {invalid && (
          <p role="alert" className="text-destructive sm:col-span-2 text-sm">
            {t('invalid')}
          </p>
        )}

        <div className="sm:col-span-2">
          <Button type="submit" className="w-full sm:w-auto">
            {t('submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
