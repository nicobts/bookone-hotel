/**
 * The Guest Desk demo property (WP0.5).
 *
 *   pnpm demo:seed
 *
 * Re-runnable from a clean database or over itself: it deletes the demo
 * property and everything scoped to it, then builds it again — never touching
 * any other property. Loopback only; it publishes its own passwords.
 *
 * A fictional hotel ("Hotel Demo Trieste"). No real hotel's content is used
 * (WP0.5 stop-and-ask). City facts in the knowledge base are general, dated and
 * live in `content/demo/kb.json`, which the golden eval also reads.
 *
 * Bookings go through the domain's own commands — hold, guest, confirm, party,
 * documents, arrival — so every state on screen was reached the way a real
 * stay reaches it, and every transition is in the event log.
 *
 * Features: the Phase 0 set, plus `pms_sync` (against the mock PMS, so
 * availability exists) and `booking_engine` (so pre-sale can hand out a booking
 * link), plus `document_ocr` for demo documents only (ADR-029), plus
 * `alloggiati` for Phase 1 (WP1.1): obligations are generated and filed through
 * the lifecycle against the **mock** channel — nothing reaches the Questura,
 * and the worker refuses to boot simulated in production. Revoke it from the
 * operator console to show the Phase 0 flow, where capture ends at staff
 * confirmation.
 *
 * Jurisdiction: Friuli Venezia Giulia, Trieste (`settings.jurisdiction`, the
 * region registry's first entry — ADR-028).
 */
import { existsSync, readFileSync } from 'node:fs'
import postgres from 'postgres'
import { attachGuest, confirmReservation, createHold } from '../packages/core/src/booking'
import {
  applyJourneyCommand,
  confirmDocuments,
  recordDocument,
  saveParty,
  setExpectedArrival,
  signStayToken,
} from '../packages/core/src/journey'
import { logComplaint } from '../packages/core/src/concierge/complaints'
import { grantEntitlement } from '../packages/core/src/onboarding/entitlements'
import { PHASE0_FEATURES } from '../packages/core/src/onboarding/features'
import { agentActor } from '../packages/core/src/events/actor'
import { closeConnection } from '../packages/core/src/db/client'
import {
  ALLOGGIATI_ADAPTER_ID,
  createAlloggiatiComplianceAdapter,
  generateGuestRegistrations,
  listObligationIds,
  runObligation,
} from '../packages/core/src/compliance'
import { zonedStartOfDay } from '../packages/core/src/policy/booking-policy'
import { MockAlloggiatiAdapter } from '../packages/adapters/src/mock-alloggiati'

/**
 * Where it seeds: local by default (`.env`), or the staging project with
 * `pnpm demo:seed -- --staging` (`.env.staging`, docs/runbooks/staging.md).
 * Never production — there is no flag for it, and the guard below refuses any
 * host it cannot name.
 */
const STAGING = process.argv.includes('--staging')
const envFile = new URL(STAGING ? '../.env.staging' : '../.env', import.meta.url)
if (existsSync(envFile)) process.loadEnvFile(envFile.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
else if (STAGING) {
  console.error('No .env.staging: see docs/runbooks/staging.md.')
  process.exit(1)
}

const SLUG = 'demo-trieste'
/**
 * Local: the published dev password, which the dev login helper fills in.
 * Staging: a generated one from `.env.staging` — staging is reachable from the
 * internet, and a password printed in a repository is nobody's secret.
 */
const PASSWORD = STAGING ? (process.env.DEMO_PASSWORD ?? '') : 'devpassword123!'
const OWNER_EMAIL = 'owner@demo.bookone.test'
const STAFF_EMAIL = 'staff@demo.bookone.test'
/** Fictional numbers, in the reserved 040 000 range. The owner agent answers only these (ADR-021). */
const OWNER_PHONES = ['+39 040 0000001']
/** The front desk's phone: the staff rung of the filing-deadline alerts (WP1.5). */
const STAFF_PHONES = ['+39 040 0000002']

/**
 * WhatsApp for the demo (ADR-035), all optional:
 *   TWILIO_WHATSAPP_FROM — the sender (sandbox or approved number); it becomes
 *                          the demo property's WhatsApp number.
 *   DEMO_OWNER_PHONE     — the presenter's phone, added to the owner numbers so
 *                          they can ask the owner agent on WhatsApp.
 *   DEMO_GUEST_PHONE     — a second phone, given to the guest arriving tomorrow,
 *                          so the guest side can be played on WhatsApp.
 *   DEMO_STAFF_PHONE     — a phone added to the staff numbers, so the filing
 *                          deadline alert (WP1.5) can be shown arriving.
 * Real numbers of people who volunteered them, used only on this fictional
 * property. Unset, the demo is webchat-only, as before.
 */
const WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_FROM?.trim() || null
const DEMO_OWNER_PHONE = process.env.DEMO_OWNER_PHONE?.trim() || null
const DEMO_GUEST_PHONE = process.env.DEMO_GUEST_PHONE?.trim() || null
const DEMO_STAFF_PHONE = process.env.DEMO_STAFF_PHONE?.trim() || null

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (STAGING) {
  // Staging only, and only the project `.env.staging` names: the API and the
  // database must both be that project, the file must say it is staging, and
  // the demo password must be a generated one. Anything else is refused.
  const ref = process.env.SUPABASE_STAGING_PROJECT_REF ?? ''
  if (
    process.env.BOOKONE_ENVIRONMENT !== 'staging' ||
    !/^[a-z]{20}$/.test(ref) ||
    apiUrl !== `https://${ref}.supabase.co` ||
    !(process.env.DATABASE_URL ?? '').includes(`postgres.${ref}:`) ||
    PASSWORD.length < 16
  ) {
    console.error('Refusing to seed: .env.staging does not describe the staging project.')
    process.exit(1)
  }
} else if (
  !/(127\.0\.0\.1|localhost|\[::1\])/.test(apiUrl) ||
  !/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')
) {
  console.error('Refusing to seed a non-loopback host. This seed publishes its own passwords.')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL ?? '', { prepare: false, onnotice: () => {} })

async function admin(path: string, init: RequestInit = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

async function createUser(email: string, fullName: string): Promise<string> {
  const { users } = (await admin('/auth/v1/admin/users?per_page=200')) as {
    users: { id: string; email: string }[]
  }
  const existing = users.find((u) => u.email === email)
  if (existing) await admin(`/auth/v1/admin/users/${existing.id}`, { method: 'DELETE' })

  const user = (await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  })) as { id: string }
  return user.id
}

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
}

// ------------------------------------------------------------ clean slate
const [previous] = await sql`select id from properties where slug = ${SLUG}`
if (previous) {
  // Events and runs first: they reference the property and are kept on their
  // own clock elsewhere; here the whole demo goes.
  await sql`delete from domain_events where property_id = ${previous.id}`
  await sql`delete from agent_runs where property_id = ${previous.id}`
  await sql`delete from properties where id = ${previous.id}`
}

// --------------------------------------------------------------- property
const [property] = await sql`
  insert into properties (slug, name, locale_default, languages, timezone, settings)
  values (
    ${SLUG}, 'Hotel Demo Trieste', 'it', '["it","en","de","sl"]'::jsonb, 'Europe/Rome',
    ${sql.json({
      theme: { primary: '#1E4E79', accent: '#E0A458' },
      contact: { email: 'reception@demo-trieste.test', phone: '+39 040 0000000' },
      businessHours: '08:00–22:00',
      // Region as ISO 3166-2, comune as its ISTAT code (ADR-028, ADR-039).
      jurisdiction: { region: 'IT-36', comune: '032006' },
      touristTax: {
        amountCentsPerPersonPerNight: 250,
        currency: 'EUR',
        maxNights: 5,
        exemptUnderAge: 14,
      },
      policy: {
        deposit: { mode: 'percent', percent: 30 },
        cancellation: [
          { hoursBeforeArrival: 72, refundPercent: 100 },
          { hoursBeforeArrival: 24, refundPercent: 50 },
        ],
        vaultCard: false,
      },
      fees: { directBookingBps: 300, aiAttributedBps: 1000 },
      documentRetentionDays: 1,
      // The agent playground runs real turns and refuses any property without
      // this flag (ADR-037). Only this seed sets it.
      demo: true,
      ownerPhones: DEMO_OWNER_PHONE ? [...OWNER_PHONES, DEMO_OWNER_PHONE] : OWNER_PHONES,
      staffPhones: DEMO_STAFF_PHONE ? [...STAFF_PHONES, DEMO_STAFF_PHONE] : STAFF_PHONES,
      ...(WHATSAPP_NUMBER ? { whatsappNumber: WHATSAPP_NUMBER } : {}),
    })}
  )
  returning id`
const propertyId = property!.id as string

const ownerId = await createUser(OWNER_EMAIL, 'Giulia Demo')
const staffId = await createUser(STAFF_EMAIL, 'Luca Demo')
await sql`insert into property_members (property_id, user_id, role) values
  (${propertyId}, ${ownerId}, 'owner'), (${propertyId}, ${staffId}, 'staff')`

// Room codes the mock PMS knows, so availability refreshes find them.
const rooms: Record<string, string> = {}
for (const [code, capacity, names] of [
  [
    'DBL',
    2,
    {
      it: 'Camera doppia vista mare',
      en: 'Double room, sea view',
      de: 'Doppelzimmer Meerblick',
      sl: 'Dvoposteljna soba s pogledom na morje',
    },
  ],
  [
    'SGL',
    1,
    { it: 'Camera singola', en: 'Single room', de: 'Einzelzimmer', sl: 'Enoposteljna soba' },
  ],
  [
    'FAM',
    4,
    { it: 'Camera familiare', en: 'Family room', de: 'Familienzimmer', sl: 'Družinska soba' },
  ],
] as const) {
  const [row] = await sql`insert into room_types (property_id, code, name_i18n, capacity)
    values (${propertyId}, ${code}, ${sql.json(names)}, ${capacity}) returning id`
  rooms[code] = row!.id as string
}

// ----------------------------------------------------------- knowledge base
const kb = JSON.parse(
  readFileSync(new URL('../content/demo/kb.json', import.meta.url), 'utf8'),
) as {
  articles: { topic: string; questionVariants: string[]; answers: Record<string, string> }[]
}
for (const article of kb.articles) {
  await sql`insert into kb_articles (property_id, topic, question_variants, answers, published)
    values (${propertyId}, ${article.topic}, ${sql.json(article.questionVariants)}, ${sql.json(article.answers)}, true)`
}

// ---------------------------------------------------------------- features
// WhatsApp only when a sender is configured: a channel with no number would
// be a feature that is on and can never be used.
for (const feature of [
  ...PHASE0_FEATURES,
  'pms_sync',
  'booking_engine',
  'document_ocr',
  'alloggiati',
  // The daily ISTAT return (WP1.3), on the mock transport: the demo is in FVG.
  'istat_regional',
  ...(WHATSAPP_NUMBER ? (['whatsapp'] as const) : []),
] as const) {
  await grantEntitlement({ propertyId, feature, note: 'seed-demo' })
}
// Three days of ISTAT returns to show: as if the demo had switched the return
// on three days ago. Demo property only.
await sql`update entitlements set granted_at = now() - interval '3 days'
           where property_id = ${propertyId} and feature = 'istat_regional'`

// ---------------------------------------------------------------- bookings
type Stage = 'future' | 'invited' | 'details' | 'documents' | 'inhouse' | 'departed'

const GUESTS: [string, string, string, 'm' | 'f', string][] = [
  ['Rossi', 'Marco', 'IT', 'm', 'it'],
  ['Bianchi', 'Giulia', 'IT', 'f', 'it'],
  ['Huber', 'Anna', 'AT', 'f', 'de'],
  ['Novak', 'Luka', 'SI', 'm', 'sl'],
  ['Schmidt', 'Jonas', 'DE', 'm', 'de'],
  ['Smith', 'Emily', 'GB', 'f', 'en'],
  ['Colombo', 'Paolo', 'IT', 'm', 'it'],
  ['Kovač', 'Maja', 'SI', 'f', 'sl'],
  ['Gruber', 'Lena', 'AT', 'f', 'de'],
  ['Martin', 'Claire', 'FR', 'f', 'en'],
  ['Ricci', 'Sara', 'IT', 'f', 'it'],
  ['Weber', 'Tobias', 'DE', 'm', 'de'],
  ['Horvat', 'Ivan', 'HR', 'm', 'en'],
  ['Johnson', 'Mark', 'US', 'm', 'en'],
  ['Esposito', 'Chiara', 'IT', 'f', 'it'],
  ['Moser', 'Katrin', 'AT', 'f', 'de'],
  ['Zupan', 'Nina', 'SI', 'f', 'sl'],
  ['Fischer', 'Lukas', 'DE', 'm', 'de'],
  ['Brown', 'Olivia', 'GB', 'f', 'en'],
  ['Galli', 'Andrea', 'IT', 'm', 'it'],
  ['Wagner', 'Sophie', 'AT', 'f', 'de'],
  ['Kralj', 'Tim', 'SI', 'm', 'sl'],
  ['Lombardi', 'Elena', 'IT', 'f', 'it'],
  ['Davies', 'Tom', 'GB', 'm', 'en'],
  ['Fontana', 'Luca', 'IT', 'm', 'it'],
]

// [arrival offset in days, nights, room, stage] — 25 stays across the timeline.
const PLAN: [number, number, string, Stage][] = [
  [-9, 3, 'DBL', 'departed'],
  [-7, 2, 'SGL', 'departed'],
  [-6, 4, 'FAM', 'departed'],
  [-5, 2, 'DBL', 'departed'],
  [-4, 3, 'DBL', 'departed'],
  [-2, 4, 'DBL', 'inhouse'],
  [-1, 3, 'FAM', 'inhouse'],
  [-1, 2, 'SGL', 'inhouse'],
  [0, 3, 'DBL', 'inhouse'],
  [1, 2, 'DBL', 'documents'],
  [1, 3, 'SGL', 'details'],
  [1, 2, 'FAM', 'invited'],
  [2, 2, 'DBL', 'details'],
  [2, 4, 'DBL', 'documents'],
  [3, 2, 'SGL', 'future'],
  [5, 3, 'DBL', 'future'],
  [7, 2, 'FAM', 'future'],
  [9, 5, 'DBL', 'future'],
  [12, 2, 'SGL', 'future'],
  [14, 3, 'DBL', 'future'],
  [18, 4, 'FAM', 'future'],
  [21, 2, 'DBL', 'future'],
  [25, 3, 'DBL', 'future'],
  [28, 2, 'SGL', 'future'],
  [30, 7, 'DBL', 'future'],
]

const PRICE: Record<string, number> = { SGL: 9_500, DBL: 14_500, FAM: 21_000 }
const made: {
  reservationId: string
  stage: Stage
  name: string
  locale: string
  arrival: string
  departure: string
}[] = []

for (const [index, [offset, nightCount, code, stage]] of PLAN.entries()) {
  const [surname, givenName, country, sex, locale] = GUESTS[index]!
  const arrival = day(offset)
  const departure = day(offset + nightCount)
  const adults = code === 'SGL' ? 1 : 2

  const nights = Array.from({ length: nightCount }, (_, n) => {
    const date = day(offset + n)
    return { date, priceCents: PRICE[code]!, currency: 'EUR', snapshotId: `demo-${date}` }
  })

  const hold = await createHold({
    propertyId,
    roomTypeId: rooms[code]!,
    arrival,
    departure,
    adults,
    children: 0,
    nights,
  })
  if (hold.status !== 'held') throw new Error(`hold ${index}: ${hold.reason}`)

  const email =
    `${givenName}.${surname}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@example.test'
  await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: { name: `${givenName} ${surname}`, email, locale },
  })
  const confirmed = await confirmReservation({ propertyId, reservationId: hold.reservationId })
  if (confirmed.status !== 'confirmed') throw new Error(`confirm ${index}: ${confirmed.status}`)

  const reservationId = hold.reservationId
  const withDetails = stage !== 'future' && stage !== 'invited'
  const withDocuments = stage === 'documents' || stage === 'inhouse' || stage === 'departed'

  if (withDetails) {
    const members = Array.from({ length: adults }, (_, g) => ({
      guestIndex: g,
      surname,
      givenName: g === 0 ? givenName : 'Ospite',
      sex: g === 0 ? sex : sex === 'm' ? ('f' as const) : ('m' as const),
      birthDate: g === 0 ? '1984-05-12' : '1986-09-03',
      birthCountry: country,
      citizenship: country,
      documentType: 'passport' as const,
      documentNumber: `DEMO${String(index).padStart(3, '0')}${g}`,
    }))
    await saveParty({ propertyId, reservationId, members })
  }

  if (withDocuments) {
    for (let g = 0; g < adults; g += 1) {
      // Paths only — the demo holds no document images. Deletion jobs find no
      // object and record the stay as cleared, which is what they should do.
      await recordDocument({
        propertyId,
        reservationId,
        guestIndex: g,
        documentPath: `${propertyId}/${reservationId}/${g}`,
      })
    }
  }

  if (stage === 'details' || stage === 'documents') {
    await setExpectedArrival({ propertyId, reservationId, time: index % 2 ? '18:30' : '21:00' })
  }

  if (stage === 'inhouse' || stage === 'departed') {
    // Checked in at the desk: a person confirmed the party against their
    // documents (WP0.4) — except today's arrival, left for the demo to confirm.
    if (offset < 0) {
      const checked = await confirmDocuments({ propertyId, reservationId, userId: staffId })
      if (checked.status !== 'confirmed')
        throw new Error(`confirmDocuments ${index}: ${checked.status}`)
    }
    await applyJourneyCommand({ propertyId, reservationId, command: { type: 'arrival.confirm' } })
  }

  if (stage === 'departed') {
    await applyJourneyCommand({ propertyId, reservationId, command: { type: 'departure.settle' } })
    await applyJourneyCommand({ propertyId, reservationId, command: { type: 'departure.close' } })
  }

  made.push({ reservationId, stage, name: `${givenName} ${surname}`, locale, arrival, departure })
}

// Two open complaints on stays in the house (WP0.5).
// ------------------------------------------------------------- compliance
// Phase 1 (WP1.1, ADR-039): the Questura filing for every stay a person has
// confirmed, run through the real lifecycle against the **mock** channel, as
// of each stay's arrival day at noon — so past stays read as filed on time,
// the way they would have been. Nothing reaches the Questura. Today's arrival
// is left pending until someone confirms it in the console.
{
  const compliance = {
    adapters: new Map([
      [ALLOGGIATI_ADAPTER_ID, createAlloggiatiComplianceAdapter(new MockAlloggiatiAdapter())],
    ]),
  }
  await generateGuestRegistrations(compliance, { limit: 100, propertyId })
  for (const stay of made) {
    const noon = new Date(zonedStartOfDay(stay.arrival, 'Europe/Rome').getTime() + 12 * 3_600_000)
    for (const obligationId of await listObligationIds({
      propertyId,
      reservationId: stay.reservationId,
    })) {
      // Two steps: queue and file, then (for a channel that answers later) ask.
      await runObligation({ ...compliance, now: () => noon }, obligationId)
      await runObligation(
        { ...compliance, now: () => new Date(noon.getTime() + 15 * 60_000) },
        obligationId,
      )
    }
  }
}

const inHouse = made.filter((stay) => stay.stage === 'inhouse')
await logComplaint({
  propertyId,
  reservationId: inHouse[0]!.reservationId,
  category: 'noise',
  summary: 'Loud music from the street after midnight',
  actor: agentActor('AG-01'),
})
await logComplaint({
  propertyId,
  reservationId: inHouse[1]!.reservationId,
  category: 'cleanliness',
  summary: 'Bathroom not cleaned this morning',
  actor: agentActor('AG-01'),
})

// ------------------------------------------------------------------ summary
const counts = made.reduce<Record<string, number>>(
  (all, stay) => ({ ...all, [stay.stage]: (all[stay.stage] ?? 0) + 1 }),
  {},
)
const arriving = made.find((stay) => stay.stage === 'invited')!

if (DEMO_GUEST_PHONE) {
  await sql`
    update guests set phone = ${DEMO_GUEST_PHONE}
     where id = (select guest_id from reservations where id = ${arriving.reservationId})`
}

console.log(
  `Seeded ${SLUG}: ${made.length} stays ${JSON.stringify(counts)}, ${kb.articles.length} articles, 2 open complaints.`,
)
console.log('')
console.log(`  console   http://localhost:3000/it/${SLUG}/console/today`)
console.log(
  `            ${OWNER_EMAIL} (owner) · ${STAFF_EMAIL} (staff) · password ${STAGING ? 'DEMO_PASSWORD in .env.staging' : PASSWORD}`,
)
console.log(`  booking   http://localhost:3000/en/book/${SLUG}`)
console.log(
  `  guest     http://localhost:3000/${arriving.locale}/stay/${signStayToken(arriving.reservationId, arriving.departure)}  (${arriving.name}, arriving tomorrow)`,
)
console.log(
  `  owner     ${[...OWNER_PHONES, ...(DEMO_OWNER_PHONE ? [DEMO_OWNER_PHONE] : [])].join(', ')} — the only numbers the owner agent answers`,
)
console.log(
  `  staff     ${[...STAFF_PHONES, ...(DEMO_STAFF_PHONE ? [DEMO_STAFF_PHONE] : [])].join(', ')} — the staff rung of the filing alerts`,
)
console.log(
  WHATSAPP_NUMBER
    ? `  whatsapp  ${WHATSAPP_NUMBER}${DEMO_GUEST_PHONE ? ` · ${DEMO_GUEST_PHONE} plays ${arriving.name}` : ''}`
    : '  whatsapp  off (set TWILIO_WHATSAPP_FROM to turn it on for the demo)',
)

await sql.end()
await closeConnection()
process.exit(0)
