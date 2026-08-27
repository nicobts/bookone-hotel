/**
 * Supported locales (D13, 03-ARCHITECTURE §6).
 *
 * V1 is IT/AT/SI. Adding a locale is a product decision, not a config change:
 * 00-PROJECT-OVERVIEW §6 lists "no multi-language beyond IT/DE/EN/SL" as a
 * non-goal.
 */
export const locales = ['it', 'de', 'en', 'sl'] as const

export type Locale = (typeof locales)[number]

/**
 * Last resort in the fallback chain guest -> property default -> en.
 * A property sets its own default in `properties.locale_default`.
 */
export const fallbackLocale: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

/**
 * Resolve the locale to render in, given what the guest asked for and what the
 * property defaults to. Neither input is trusted to be a supported locale.
 */
export function resolveLocale(guest?: unknown, propertyDefault?: unknown): Locale {
  if (isLocale(guest)) return guest
  if (isLocale(propertyDefault)) return propertyDefault
  return fallbackLocale
}
