#!/usr/bin/env node
/**
 * Local development seed.
 *
 * Two properties, not one. A single-property seed cannot show the switcher
 * working, and cannot show isolation failing when it breaks — every query
 * returns the only rows there are, so a policy that does nothing looks
 * identical to a policy that works. The asymmetry between the two accounts is
 * the point:
 *
 *   owner@bookone.test   owner of Hotel Sonja, staff at Garni Alpin
 *                        -> two properties, so the switcher has something to do
 *   staff@bookone.test   staff at Hotel Sonja only
 *                        -> one property, so the switcher hides itself, and
 *                           reaching /it/garni-alpin/console must 404
 *
 * Refuses to run against anything that is not a loopback address, because the
 * password below is published in this file.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const PASSWORD = 'devpassword123!'

function loadEnv() {
  const path = fileURLToPath(new URL('../.env', import.meta.url))
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^"|"$/g, '')
  }
  return env
}

const env = { ...loadEnv(), ...process.env }
const apiUrl = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const databaseUrl = env.DATABASE_URL

if (!/(127\.0\.0\.1|localhost|\[::1\])/.test(apiUrl ?? '')) {
  console.error(`Refusing to seed a non-loopback host: ${apiUrl}`)
  console.error('This seed publishes its own passwords and truncates tables.')
  process.exit(1)
}

async function admin(path, init = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

/** Idempotent: delete any existing test user first, so re-running is safe. */
async function createUser(email, fullName) {
  const { users } = await admin('/auth/v1/admin/users?per_page=200')
  const existing = users.find((u) => u.email === email)
  if (existing) await admin(`/auth/v1/admin/users/${existing.id}`, { method: 'DELETE' })

  const user = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  })
  return user.id
}

const sql = postgres(databaseUrl, { prepare: false, onnotice: () => {} })

try {
  // `properties` cascades to everything property-scoped.
  await sql`truncate table properties restart identity cascade`

  const ownerId = await createUser('owner@bookone.test', 'Markus Rainer')
  const staffId = await createUser('staff@bookone.test', 'Lena Fischer')

  // Settings carry what the booking surface reads: the whitelabel colours
  // (PRD A1), the contact the stale-source fallback offers, and the tourist-tax
  // rule the review step states as a note rather than a charge.
  //
  // The two properties are deliberately themed differently. One property
  // looking like the other is how per-property theming passes review while
  // being broken.
  const [sonja] = await sql`
    insert into properties (slug, name, locale_default, languages, timezone, settings)
    values (
      'hotel-sonja', 'Hotel Sonja', 'de', '["de","it","en"]'::jsonb, 'Europe/Rome',
      '{
        "theme": {"primary": "#1F6F5C", "accent": "#E0A458"},
        "contact": {"email": "reception@hotel-sonja.test", "phone": "+39 0471 000001"},
        "touristTax": {"amountCentsPerPersonPerNight": 200, "currency": "EUR", "maxNights": 5, "exemptUnderAge": 14}
      }'::jsonb
    )
    returning id`

  const [alpin] = await sql`
    insert into properties (slug, name, locale_default, languages, timezone, settings)
    values (
      'garni-alpin', 'Garni Alpin', 'it', '["it","de","en","sl"]'::jsonb, 'Europe/Rome',
      '{
        "theme": {"primary": "#7A3E9D", "accent": "#F2994A"},
        "contact": {"email": "info@garni-alpin.test"},
        "touristTax": {"amountCentsPerPersonPerNight": 150, "currency": "EUR"}
      }'::jsonb
    )
    returning id`

  await sql`
    insert into property_members (property_id, user_id, role) values
      (${sonja.id}, ${ownerId}, 'owner'),
      (${alpin.id}, ${ownerId}, 'staff'),
      (${sonja.id}, ${staffId}, 'staff')`

  // Room types, so the booking surface has something real to read in Sprint 3.
  for (const property of [sonja, alpin]) {
    await sql`
      insert into room_types (property_id, code, name_i18n, capacity) values
        (${property.id}, 'DBL', '{"de":"Doppelzimmer","it":"Camera doppia","en":"Double room","sl":"Dvoposteljna soba"}'::jsonb, 2),
        (${property.id}, 'SGL', '{"de":"Einzelzimmer","it":"Camera singola","en":"Single room","sl":"Enoposteljna soba"}'::jsonb, 1),
        (${property.id}, 'FAM', '{"de":"Familienzimmer","it":"Camera familiare","en":"Family room","sl":"Družinska soba"}'::jsonb, 4)`
  }

  // One event per property, so the log is not empty on first look — Sprint 1's
  // DoD asks for an event log receiving writes.
  await sql`
    insert into domain_events (property_id, entity_type, event_type, origin, actor, payload) values
      (${sonja.id}, 'property', 'property.created', 'platform', 'system', '{"seed":true}'::jsonb),
      (${alpin.id}, 'property', 'property.created', 'platform', 'system', '{"seed":true}'::jsonb)`

  console.log('Seeded 2 properties, 2 accounts, 6 room types, 2 events.')
  console.log('')
  console.log('  Booking surfaces (prices arrive once the worker refreshes availability):')
  console.log('    http://localhost:3000/de/book/hotel-sonja')
  console.log('    http://localhost:3000/it/book/garni-alpin')
  console.log('')
  console.log('  owner@bookone.test  owner of Hotel Sonja, staff at Garni Alpin')
  console.log('  staff@bookone.test  staff at Hotel Sonja only')
  console.log(`  password: ${PASSWORD}`)
} finally {
  await sql.end()
}
