import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import { asService } from '../../db/session'
import { properties, registrationRecords, reservations } from '../../db/schema'
import { readJurisdiction } from '../registry'
import { buildDeclaration, type Declaration } from './declaration'
import type { TaxStay } from './engine'
import { rulesFor } from './files'

/**
 * A property's declaration for a period, from its confirmed stays (WP1.4).
 *
 * - The comune is the property's `settings.jurisdiction.comune`; a comune
 *   without a rules file has nothing to compute (`no-rules`).
 * - The category is `settings.accommodationCategory`, as the comune's rates
 *   name it (`hotel-3`, `b&b`); without it the rates cannot be read.
 * - Each guest's birth date comes from their registration record, and a
 *   declared exemption from its `taxExemption` key. Guests beyond the records
 *   count as adults, and the declaration says so.
 *
 * Stays are read for the whole period plus the stays that straddle it, so a
 * night-attributed declaration gets its first nights and a departure-
 * attributed one its whole stays.
 */
export type PropertyDeclaration =
  | { status: 'ready'; declaration: Declaration }
  | { status: 'no-rules'; comune: string | null }
  | { status: 'no-category' }

export async function declarationForProperty(
  propertyId: string,
  period: { from: string; to: string },
): Promise<PropertyDeclaration> {
  const [property] = await asService((db) =>
    db
      .select({ settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1),
  )
  const comune = readJurisdiction(property?.settings)?.comune ?? null
  const rules = comune ? rulesFor(comune) : null
  if (!rules) return { status: 'no-rules', comune }

  const category = (property?.settings as { accommodationCategory?: unknown } | null)
    ?.accommodationCategory
  if (typeof category !== 'string' || !category) return { status: 'no-category' }

  const stays = await asService(async (db) => {
    const rows = await db
      .select({
        id: reservations.id,
        reference: reservations.reference,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        pax: reservations.pax,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed'),
          lte(reservations.arrivalDate, period.to),
          gte(reservations.departureDate, period.from),
        ),
      )
      .orderBy(asc(reservations.arrivalDate))
    if (rows.length === 0) return []

    const records = await db
      .select({
        reservationId: registrationRecords.reservationId,
        data: registrationRecords.data,
      })
      .from(registrationRecords)
      .where(
        and(
          eq(registrationRecords.propertyId, propertyId),
          inArray(
            registrationRecords.reservationId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(asc(registrationRecords.guestIndex))

    return rows.map((row): TaxStay => {
      const pax = (row.pax ?? {}) as { adults?: unknown; children?: unknown }
      const count = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0)
      return {
        reference: row.reference ?? row.id.slice(0, 8),
        arrivalDate: row.arrivalDate,
        departureDate: row.departureDate,
        category,
        partySize: count(pax.adults) + count(pax.children),
        guests: records
          .filter((record) => record.reservationId === row.id)
          .map((record) => {
            const data = (record.data ?? {}) as Record<string, unknown>
            return {
              birthDate: typeof data.birthDate === 'string' ? data.birthDate : null,
              exemption: typeof data.taxExemption === 'string' ? data.taxExemption : null,
            }
          }),
      }
    })
  })

  return { status: 'ready', declaration: buildDeclaration(rules, stays, period) }
}
