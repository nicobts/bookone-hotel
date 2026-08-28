import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { RoomOption } from '@bookone/core/booking'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { BookingSearch } from '@/lib/booking/params'
import { formatMoney, roomName } from './format'

/**
 * Step 2 — one decision, made by comparing (design note §1).
 *
 * Prices are totals for the whole stay first and per-night second: the guest is
 * choosing between stays, not between nightly rates, and a per-night headline
 * is the number that turns into a complaint at checkout.
 *
 * Every option here was priced from snapshots covering every night of the stay.
 * A room the cache could not price completely is absent rather than shown
 * cheaper than it is — the filter is in `searchAvailability`, and this component
 * cannot show a partial price because it is never handed one.
 */
export async function StepRooms({
  options,
  search,
  nightCount,
  locale,
  selectAction,
  changeHref,
}: {
  options: RoomOption[]
  search: BookingSearch
  nightCount: number
  locale: string
  selectAction: (formData: FormData) => Promise<void>
  changeHref: string
}) {
  const t = await getTranslations('booking')
  const guests = search.adults + search.children

  return (
    <div>
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('rooms.title')}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        {t('rooms.subtitle', {
          nights: t('nights', { count: nightCount }),
          guests: t('guests', { count: guests }),
        })}{' '}
        ·{' '}
        <Link href={changeHref} className="underline underline-offset-4">
          {t('rooms.change')}
        </Link>
      </p>

      {options.length === 0 ? (
        <div className="mt-8">
          <p className="text-foreground text-sm font-medium">{t('rooms.none')}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t('rooms.noneHint')}</p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4">
          {options.map((option) => {
            const perNight = Math.round(option.quote.totalCents / option.quote.nightCount)

            return (
              <li key={option.roomTypeId}>
                <Card>
                  <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-foreground font-medium">
                        {roomName(option.nameI18n, locale, option.code)}
                      </h2>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t('rooms.sleeps', { capacity: option.capacity })}
                      </p>
                      <p className="text-muted-foreground mt-3 text-xs">
                        {formatMoney(perNight, option.quote.currency, locale)} {t('rooms.perNight')}
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <div className="sm:text-right">
                        <p className="text-muted-foreground text-xs">{t('rooms.total')}</p>
                        <p className="text-foreground text-xl font-semibold tabular-nums">
                          {formatMoney(option.quote.totalCents, option.quote.currency, locale)}
                        </p>
                      </div>

                      <form action={selectAction}>
                        {/* The nights travel with the choice. The hold re-prices
                            from them rather than trusting a total, and a total
                            posted from a browser is a total anyone can set. */}
                        <input type="hidden" name="roomTypeId" value={option.roomTypeId} />
                        <input type="hidden" name="arrival" value={search.arrival} />
                        <input type="hidden" name="departure" value={search.departure} />
                        <input type="hidden" name="adults" value={search.adults} />
                        <input type="hidden" name="children" value={search.children} />
                        <Button type="submit">{t('rooms.select')}</Button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
