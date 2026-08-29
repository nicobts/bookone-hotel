/**
 * Load test on the booking path (04 §1 Sprint 10).
 *
 *   pnpm tsx scripts/loadtest-booking.mts hotel-sonja 200 20
 *                                         slug       total concurrency
 *
 * Drives the **domain** path — `createHold` → `attachGuest` → `confirmReservation`
 * — rather than HTTP. That is deliberate and it is the more useful half: the web
 * layer in front of it is stateless and horizontally scalable on Vercel, and
 * every interesting failure on this path is in the database. Contention,
 * connection exhaustion, and the reference collision below all live here and
 * none of them would be visible in a test that spent its time in TLS handshakes.
 *
 * It writes real reservations. Never point it at production; it refuses a
 * non-local database below.
 *
 * ## What it is actually looking for
 *
 * **Reference collisions.** `generateReference()` draws from a 729-million
 * space and the column is unique per property. A collision throws, and what the
 * guest sees is a booking that failed for no reason they can act on. The unit
 * test asserts the generator's distribution; this asserts what happens when
 * hundreds of draws land in the same second.
 *
 * **Attribution writes.** Every hold writes an `attribution_events` row in the
 * same transaction (D14). That doubles the write per booking and it is on the
 * critical path of the one operation a hotel cannot afford to be slow.
 *
 * **Connection behaviour.** The pool is shared with everything else the process
 * does. Concurrency past its size queues rather than fails, and the question is
 * where the latency curve bends.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? ''

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error(
    'Refusing to run: this writes hundreds of real reservations and DATABASE_URL is not local.',
  )
  process.exit(1)
}

const { createHold, attachGuest, confirmReservation } =
  await import('../packages/core/src/booking/index.ts')
const { asService, closeConnection } = await import('../packages/core/src/db/index.ts')
const { properties, roomTypes } = await import('../packages/core/src/db/schema.ts')

const slug = process.argv[2] ?? 'hotel-sonja'
const total = Number(process.argv[3] ?? 200)
const concurrency = Number(process.argv[4] ?? 20)

/*
 * Filtered in JavaScript rather than with `eq()`.
 *
 * `drizzle-orm` is a dependency of the workspace packages, not of the repo
 * root, so a script here cannot import it. Two tables of seed data make the
 * difference immeasurable, and the alternative — adding the ORM to the root so
 * one script can write a `where` clause — is the wrong trade.
 */
const property = (
  await asService((db) => db.select({ id: properties.id, slug: properties.slug }).from(properties))
).find((row) => row.slug === slug)

if (!property) {
  console.error(`No property "${slug}". Run pnpm db:seed.`)
  process.exit(1)
}

const room = (
  await asService((db) =>
    db
      .select({ id: roomTypes.id, capacity: roomTypes.capacity, propertyId: roomTypes.propertyId })
      .from(roomTypes),
  )
).find((row) => row.propertyId === property.id)

if (!room) {
  console.error('That property has no room types.')
  process.exit(1)
}

/**
 * A priced night per booking, built here rather than read from the cache.
 *
 * The availability cache is mock-fed and may hold nothing for the dates we
 * want, and a load test that spends half its runs rejected for "cannot price
 * the stay" measures the rejection path. `createHold` re-prices from what it is
 * given, so supplying the nights exercises the same code with a known input.
 */
function nightsFor(offset: number) {
  const arrival = new Date(Date.now() + (offset + 400) * 86_400_000)
  const departure = new Date(arrival.getTime() + 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  return {
    arrival: iso(arrival),
    departure: iso(departure),
    nights: [{ date: iso(arrival), priceCents: 12_000, currency: 'EUR', snapshotId: null }],
  }
}

interface Sample {
  ms: number
  stage: 'hold' | 'attach' | 'confirm' | 'ok'
  error?: string
}

async function once(index: number): Promise<Sample> {
  const started = performance.now()
  const { arrival, departure, nights } = nightsFor(index % 90)

  try {
    const held = await createHold({
      propertyId: property.id,
      roomTypeId: room.id,
      arrival,
      departure,
      adults: 1,
      children: 0,
      nights: nights as never,
      engineSessionId: `load-${index}`,
    })

    if (held.status !== 'held') {
      return { ms: performance.now() - started, stage: 'hold', error: held.reason }
    }

    const attached = await attachGuest({
      propertyId: property.id,
      reservationId: held.reservationId,
      guest: { name: `Load ${index}`, email: `load-${index}@example.invalid` },
    })

    if (attached.status !== 'attached') {
      return { ms: performance.now() - started, stage: 'attach', error: attached.reason }
    }

    const confirmed = await confirmReservation({
      propertyId: property.id,
      reservationId: held.reservationId,
    })

    if (confirmed.status !== 'confirmed') {
      return { ms: performance.now() - started, stage: 'confirm', error: confirmed.reason }
    }

    return { ms: performance.now() - started, stage: 'ok' }
  } catch (error) {
    return {
      ms: performance.now() - started,
      stage: 'hold',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}

console.log(`booking path · ${slug} · ${total} bookings · ${concurrency} concurrent\n`)

const samples: Sample[] = []
let next = 0

const started = performance.now()

// A fixed pool of workers pulling from a shared counter, rather than
// `Promise.all` over everything at once. The second measures how fast the
// runtime can queue promises; this measures the system under a steady arrival
// rate, which is the shape real traffic has.
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next++
      if (index >= total) return
      samples.push(await once(index))
    }
  }),
)

const elapsed = performance.now() - started

const ok = samples.filter((sample) => sample.stage === 'ok')
const failed = samples.filter((sample) => sample.stage !== 'ok')
const sorted = ok.map((sample) => sample.ms).sort((a, b) => a - b)

console.log(`succeeded   ${ok.length}/${total}`)
console.log(`throughput  ${((total / elapsed) * 1000).toFixed(1)} bookings/s`)
console.log(`p50         ${percentile(sorted, 50).toFixed(0)} ms`)
console.log(`p95         ${percentile(sorted, 95).toFixed(0)} ms`)
console.log(`p99         ${percentile(sorted, 99).toFixed(0)} ms`)
console.log(`max         ${(sorted.at(-1) ?? 0).toFixed(0)} ms`)

if (failed.length > 0) {
  console.log(`\nfailures    ${failed.length}`)

  const byReason = new Map<string, number>()
  for (const sample of failed) {
    const key = `${sample.stage}: ${sample.error ?? 'unknown'}`
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }

  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`)
  }
}

await closeConnection()
