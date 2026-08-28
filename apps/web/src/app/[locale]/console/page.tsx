import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { defaultPropertyPath } from '@/lib/auth/current-property'
import { requireUser } from '@/lib/auth/current-user'

/**
 * `/[locale]/console` is a redirect, not a page.
 *
 * Login, password reset and email confirmation all need somewhere to send
 * people, and two of them run in the browser where the person's memberships are
 * unknown. This resolves their property server-side and forwards — so a link
 * written before any property existed still lands somewhere sensible, and
 * someone in no property gets a page that says so rather than a redirect loop
 * (ADR-016).
 */
export default async function ConsoleEntry({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const user = await requireUser(locale)
  redirect(await defaultPropertyPath(user.id, locale))
}
