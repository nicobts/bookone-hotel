import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import type { Locale } from '@bookone/i18n'
import { routing } from './routing'

/**
 * Catalogues live in @bookone/i18n so the worker templates its notifications
 * from the same files — a phrase exists once.
 *
 * The map is explicit rather than a dynamic template path: it keeps the bundler
 * honest about what ships, and a new locale fails the type check here instead
 * of 404-ing a chunk at runtime.
 */
const messages: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  it: () => import('@bookone/i18n/messages/it.json'),
  de: () => import('@bookone/i18n/messages/de.json'),
  en: () => import('@bookone/i18n/messages/en.json'),
  sl: () => import('@bookone/i18n/messages/sl.json'),
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale,
    messages: (await messages[locale]()).default,
  }
})
