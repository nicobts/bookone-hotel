import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { guests, reservations } from '../db/schema'
import { asService } from '../db/session'

/**
 * Finding the data subject a request is about.
 *
 * ## Why a search rather than a list
 *
 * An owner arrives here holding an email from a guest. They have a name or an
 * address, not a UUID, and they are looking for one person among however many
 * have ever stayed. A paginated list of every guest is the wrong shape for that
 * and it is also a worse privacy posture: a screen that renders every guest's
 * contact details by default is a screen that leaks them to whoever is standing
 * behind the desk.
 *
 * ## Scoped to one property, and that is a GDPR feature
 *
 * A guest who stayed at two properties on the platform is two `guests` rows.
 * Each property is a separate controller answering for its own processing, and
 * a search reaching across them would let one hotel discover that a person
 * stayed at another. Stated in design-notes/privacy.md §2.
 */

/**
 * Named `DataSubject`, not `Subject`.
 *
 * The data map already uses `Subject` for *whose* data a table holds — guest,
 * staff, nobody. Two exported types called the same thing in one module is the
 * kind of collision that gets resolved by an import alias somewhere and then
 * read wrong by everyone afterwards.
 */
export interface DataSubject {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  stays: number
  lastStay: string | null
  /** True once the guest row has been anonymised — the desk says so. */
  erased: boolean
}

/** How many matches a search returns before it asks for something narrower. */
const LIMIT = 20

export async function findSubjects(propertyId: string, query: string): Promise<DataSubject[]> {
  const term = query.trim()

  // No term, no results. Deliberately not "everybody": see above.
  if (term.length < 2) return []

  const pattern = `%${term}%`

  const rows = await asService((db) =>
    db
      .select({
        id: guests.id,
        name: guests.name,
        email: guests.email,
        phone: guests.phone,
        stays: sql<number>`count(${reservations.id})::int`,
        lastStay: sql<string | null>`max(${reservations.departureDate})::text`,
      })
      .from(guests)
      .leftJoin(reservations, eq(reservations.guestId, guests.id))
      .where(
        and(
          eq(guests.propertyId, propertyId),
          or(
            ilike(guests.name, pattern),
            ilike(guests.email, pattern),
            ilike(guests.phone, pattern),
          ),
        ),
      )
      .groupBy(guests.id)
      .orderBy(desc(sql`max(${reservations.departureDate})`))
      .limit(LIMIT),
  )

  return rows.map((row) => ({
    ...row,
    /*
     * `name = '—'` with no email and no phone is what erasure leaves behind.
     *
     * Shown rather than hidden: an owner who erases somebody and then searches
     * for them should find the shell and be told what it is, otherwise the
     * honest conclusion from an empty result is that the erasure did not work.
     */
    erased: row.name === '—' && row.email === null && row.phone === null,
  }))
}

/** One subject by id, for the confirmation screen. Null when not this property's. */
export async function getSubject(propertyId: string, guestId: string): Promise<DataSubject | null> {
  const [row] = await asService((db) =>
    db
      .select({
        id: guests.id,
        name: guests.name,
        email: guests.email,
        phone: guests.phone,
        stays: sql<number>`count(${reservations.id})::int`,
        lastStay: sql<string | null>`max(${reservations.departureDate})::text`,
      })
      .from(guests)
      .leftJoin(reservations, eq(reservations.guestId, guests.id))
      .where(and(eq(guests.id, guestId), eq(guests.propertyId, propertyId)))
      .groupBy(guests.id),
  )

  if (!row) return null

  return {
    ...row,
    erased: row.name === '—' && row.email === null && row.phone === null,
  }
}
