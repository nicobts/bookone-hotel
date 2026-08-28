/**
 * Formatting shared by the booking components.
 *
 * Money and dates only, and both locale-aware. Kept out of the components so
 * the guest sees one currency style and one date style across four steps —
 * inconsistency between two screens of the same flow reads as two different
 * systems, which is exactly the impression a direct booking cannot afford.
 */

export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}

/**
 * Arrival and departure are hotel-local calendar dates, not instants (03 §2).
 *
 * Formatted in UTC for that reason: rendering them in the reader's own zone
 * moves an arrival to the day before for anybody west of the property, and the
 * guest who notices is the one already on their way.
 */
export function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}

/** A clock time, in the property's zone — a hold expiry is an instant. */
export function formatTime(value: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(value)
}

/**
 * The guest's language, then the property's other names, then the code.
 *
 * The same guest → property → fallback chain as everywhere else (03 §6). Ending
 * on the room type's own code rather than an empty string: "DBL" is unhelpful,
 * but it is at least what the hotel calls it, and a blank room name on a
 * booking screen is worse than a terse one.
 */
export function roomName(
  names: Record<string, string>,
  locale: string,
  code: string | null,
): string {
  for (const key of [locale, 'en', 'it', 'de', 'sl']) {
    const value = names[key]
    if (value?.trim()) return value
  }

  return code ?? ''
}
