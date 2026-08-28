/**
 * Create a confirmed stay arriving soon, for exercising the pre-arrival flow.
 *
 * A development convenience. The booking surface can produce the same thing,
 * but only for dates the availability cache happens to cover — and the
 * pre-arrival sweep is about stays arriving in the next two days, which is
 * usually not where the mock connector has left prices.
 *
 * Goes through the same core functions the surface does: hold, attach guest,
 * confirm. Nothing here is a shortcut past the domain logic.
 *
 *   pnpm tsx scripts/demo-stay.mts hotel-sonja 1 en
 */
import postgres from 'postgres'
import { attachGuest, confirmReservation, createHold } from '../packages/core/src/booking'
import { signStayToken } from '../packages/core/src/journey'

// `postgres` directly rather than Drizzle for the two lookups: this file sits
// outside the workspace packages, so a bare `drizzle-orm` import does not
// resolve from here. The domain work still goes through core.
const sql = postgres(process.env.DATABASE_URL ?? '', { prepare: false, onnotice: () => {} })

const slug = process.argv[2] ?? 'hotel-sonja'
const inDays = Number(process.argv[3] ?? 1)
/** The locale the demo links are printed in. English by default. */
const locale = process.argv[4] ?? 'en'

const arrival = isoDate(Date.now() + inDays * 86_400_000)
const departure = isoDate(Date.now() + (inDays + 2) * 86_400_000)

const [property] = await sql`select id, name from properties where slug = ${slug}`
if (!property) throw new Error(`no property with slug ${slug}`)

const [room] = await sql`
  select id from room_types where property_id = ${property.id} and code = 'DBL'`
if (!room) throw new Error(`no DBL room type at ${slug}`)

const setup = { propertyId: property.id, propertyName: property.name, roomTypeId: room.id }

const nights = []
for (
  let t = Date.parse(`${arrival}T00:00:00Z`);
  t < Date.parse(`${departure}T00:00:00Z`);
  t += 86_400_000
) {
  const date = new Date(t).toISOString().slice(0, 10)
  nights.push({ date, priceCents: 12_000, currency: 'EUR', snapshotId: `demo-${date}` })
}

const hold = await createHold({
  propertyId: setup.propertyId,
  roomTypeId: setup.roomTypeId,
  arrival,
  departure,
  adults: 2,
  children: 0,
  nights,
})

if (hold.status !== 'held') throw new Error(`hold failed: ${hold.reason}`)

await attachGuest({
  propertyId: setup.propertyId,
  reservationId: hold.reservationId,
  guest: { name: 'Anna Huber', email: 'anna.huber@example.test', locale },
})

const confirmed = await confirmReservation({
  propertyId: setup.propertyId,
  reservationId: hold.reservationId,
})

if (confirmed.status !== 'confirmed' && confirmed.status !== 'already-confirmed') {
  throw new Error(`confirm failed: ${confirmed.status}`)
}

const token = signStayToken(hold.reservationId, departure)

console.log(`property     ${setup.propertyName} (${slug})`)
console.log(`reservation  ${hold.reservationId}`)
console.log(`reference    ${hold.reference}`)
console.log(`arriving     ${arrival} -> ${departure}`)
console.log('')
console.log(`stay link    http://localhost:3000/${locale}/stay/${token}`)

await sql.end()
process.exit(0)

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
