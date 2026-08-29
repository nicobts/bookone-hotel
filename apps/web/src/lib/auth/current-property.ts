import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import {
  getProfile,
  getUserPropertyBySlug,
  listUserProperties,
  type UserProperty,
} from '@bookone/core/db'
import { requireUser } from './current-user'

/**
 * Per-request memoisation.
 *
 * The layout resolves the property, then the page resolves it again — React
 * does not thread values from a layout into the pages beneath it, and passing
 * the property down as a prop would mean every page accepting something it must
 * not be trusted to have. `cache` makes the honest version cost one query
 * instead of two. Request-scoped, so nothing leaks between users.
 */
const loadProperty = cache(getUserPropertyBySlug)
const loadProperties = cache(listUserProperties)
export const loadProfile = cache(getProfile)

/**
 * Resolve the property named in the URL, for the signed-in user.
 *
 * Every page under `/[locale]/[property]/…` starts here. It returns the user
 * and the property together because no console page needs one without the
 * other, and two separate calls invite a page that fetches the user, forgets
 * the property, and quietly queries across all of them.
 */
export async function requireProperty(locale: string, slug: string) {
  const user = await requireUser(locale)
  const property = await loadProperty(user.id, slug)

  // `notFound`, not a redirect to a property they do have. A slug is guessable,
  // so this URL will be typed by people who are not members — and 404 is the
  // only response that does not confirm whether the property exists.
  //
  // Note what is doing the work: RLS returned no row. The check below reports
  // that; it does not enforce it (ADR-016).
  if (!property) notFound()

  return { user, property }
}

/**
 * The same, for a page only an owner may see (E5.5).
 *
 * ## 404, not 403
 *
 * A staff member who types the settings URL gets exactly what a non-member
 * typing another property's slug gets. "This exists and you may not see it" is
 * more than the URL needs to say, and the two cases should be indistinguishable
 * from outside — a seasonal receptionist probing what else is there learns
 * nothing either way.
 *
 * ## This is the enforcement; the sidebar is not
 *
 * Hiding a nav item is presentation. Every owner-only route calls this, and
 * every owner-only server action calls it again — a page check does not protect
 * an action, because an action is a separate request and the form that posts to
 * it is a string in somebody's browser.
 *
 * `property_members.role` is the source. RLS scopes *which properties* a person
 * sees; it does not express "owner may configure, staff may operate", which is
 * a product rule about one property rather than an isolation boundary between
 * two (ADR-016).
 */
export async function requireOwner(locale: string, slug: string) {
  const context = await requireProperty(locale, slug)

  if (context.property.role !== 'owner') notFound()

  return context
}

/**
 * Where someone lands when they arrive without naming a property — after
 * login, or at `/it` with a session already in place.
 *
 * Prefers the property stored on the profile, falling back to the first
 * alphabetically, which is the same order the switcher uses.
 */
export async function defaultProperty(userId: string): Promise<UserProperty | null> {
  const properties = await loadProperties(userId)

  // Someone with no membership is not broken, just unplaced: invited but not
  // yet added, or added and later removed. Null rather than a throw — the
  // caller has somewhere sensible to send them.
  if (properties.length === 0) return null

  const profile = await loadProfile(userId)

  // The membership re-check is the point. An owner removed from the property
  // they had chosen would otherwise be redirected into a 404 on every login,
  // with nothing on screen explaining why. The stored id is a preference, never
  // a permission.
  const preferred = profile?.defaultPropertyId
    ? properties.find((p) => p.id === profile.defaultPropertyId)
    : undefined

  return preferred ?? properties[0] ?? null
}

/** The path form of `defaultProperty`, including the no-membership landing. */
export async function defaultPropertyPath(userId: string, locale: string): Promise<string> {
  const property = await defaultProperty(userId)
  if (!property) return `/${locale}/no-property`

  return `/${locale}/${property.slug}/console/today`
}

/** The properties to offer in the switcher. Empty and single-entry are both valid. */
export async function switcherProperties(userId: string): Promise<UserProperty[]> {
  return loadProperties(userId)
}
