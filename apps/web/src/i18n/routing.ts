import { defineRouting } from 'next-intl/routing'
import { fallbackLocale, locales } from '@bookone/i18n'

/**
 * Locale routing for all three surfaces (03-ARCHITECTURE §6).
 *
 * `always` keeps the locale in the path, so a guest link is unambiguous when it
 * is forwarded, printed on a keycard sleeve, or opened months later — the
 * locale a reservation was made in stays reproducible.
 */
export const routing = defineRouting({
  locales,
  defaultLocale: fallbackLocale,
  localePrefix: 'always',
})
