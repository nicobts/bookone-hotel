import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { getCurrentUser } from '@/lib/auth/current-user'

/**
 * The root of a locale.
 *
 * Signed in -> the console. Signed out -> login. There is no marketing page in
 * this app: the marketing site is a separate surface, and a half-built landing
 * page here would be the first thing anyone saw.
 */
export default async function LocaleRoot({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  redirect((await getCurrentUser()) ? `/${locale}/console` : `/${locale}/login`)
}
