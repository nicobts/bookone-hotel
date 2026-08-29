import { and, asc, eq } from 'drizzle-orm'
import { withUser } from '../session'
import { properties, propertyMembers } from '../schema'

/**
 * Property reads, scoped to what a person may see.
 *
 * Every function here goes through `withUser`, so the database decides what
 * comes back (ADR-018). The `where` clauses are for *scoping* — which property
 * am I asking about — never for isolation. If one were deleted the result would
 * be wrong, not unsafe.
 */

export interface UserProperty {
  id: string
  slug: string
  name: string
  localeDefault: string
  timezone: string
  /**
   * The languages this property operates in.
   *
   * Carried on the console's own property object because two surfaces need to
   * know it and neither should re-query: the knowledge editor offers one answer
   * box per language, and the concierge escalates for the rest. Offering a
   * Slovenian box to an Italian-and-German property is offering a field that
   * will be empty forever and read as an omission.
   */
  languages: string[]
  role: 'owner' | 'staff'
}

/** Jsonb, so it can be anything. A property with no list operates in its own default. */
function readLanguages(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback]

  const languages = value.filter((entry): entry is string => typeof entry === 'string')

  return languages.length > 0 ? languages : [fallback]
}

/**
 * The property named in the URL, for this user — or null.
 *
 * Null rather than a throw: the caller turns it into a 404, and a slug is
 * guessable, so 404 is the only response that does not confirm whether the
 * property exists.
 */
export async function getUserPropertyBySlug(
  userId: string,
  slug: string,
): Promise<UserProperty | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: properties.id,
        slug: properties.slug,
        name: properties.name,
        localeDefault: properties.localeDefault,
        timezone: properties.timezone,
        languages: properties.languages,
        role: propertyMembers.role,
      })
      .from(properties)
      .innerJoin(propertyMembers, eq(propertyMembers.propertyId, properties.id))
      .where(and(eq(properties.slug, slug), eq(propertyMembers.userId, userId)))
      .limit(1),
  )

  const row = rows[0]
  if (!row) return null

  return { ...row, languages: readLanguages(row.languages, row.localeDefault) }
}

/**
 * Every property this person belongs to, alphabetically.
 *
 * The order is load-bearing in one place: it is also the fallback when a
 * profile names no default property, and the settings copy says "first property
 * alphabetically". Change one and the other stops being true.
 */
export async function listUserProperties(userId: string): Promise<UserProperty[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: properties.id,
        slug: properties.slug,
        name: properties.name,
        localeDefault: properties.localeDefault,
        timezone: properties.timezone,
        languages: properties.languages,
        role: propertyMembers.role,
      })
      .from(properties)
      .innerJoin(propertyMembers, eq(propertyMembers.propertyId, properties.id))
      .where(eq(propertyMembers.userId, userId))
      .orderBy(asc(properties.name)),
  )

  return rows.map((row) => ({
    ...row,
    languages: readLanguages(row.languages, row.localeDefault),
  }))
}
