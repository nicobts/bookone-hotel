/**
 * Look at what the engine actually did.
 *
 * A development convenience for the questions that come up while working on the
 * booking and sync paths, each of which is otherwise a hand-written join:
 * did the cache refresh, did the booking land, did the guest get told, what is
 * scheduled.
 *
 *   node scripts/inspect.mjs snapshots
 *   node scripts/inspect.mjs reservations
 *   node scripts/inspect.mjs notifications
 *   node scripts/inspect.mjs events
 *   node scripts/inspect.mjs schedules
 *
 * Read-only, and loopback-only for the same reason the seed script is: it
 * prints guest email addresses, which belong on a developer's disposable
 * database and nowhere else.
 */
import { existsSync } from 'node:fs'
import postgres from 'postgres'

if (existsSync(new URL('../.env', import.meta.url))) {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
}

const databaseUrl = process.env.DATABASE_URL ?? ''

if (!/(127\.0\.0\.1|localhost|\[::1\])/.test(databaseUrl)) {
  console.error('inspect.mjs refuses to run against a non-loopback database.')
  process.exit(1)
}

const sql = postgres(databaseUrl, { prepare: false, onnotice: () => {} })

const views = {
  snapshots: () => sql`
    select p.slug,
           count(*)::int                                                as rows,
           count(distinct r.room_type_id)::int                          as room_types,
           min(r.date_from)                                             as first_night,
           max(r.date_from)                                             as last_night,
           round(extract(epoch from (now() - min(r.fetched_at))))::int  as oldest_seconds
      from rate_snapshots r
      join properties p on p.id = r.property_id
     group by 1 order by 1`,

  reservations: () => sql`
    select r.reference, p.slug, r.status, r.origin, r.arrival_date, r.departure_date,
           r.total_cents, g.email,
           (select count(*) from external_refs x where x.entity_id = r.id)::int as refs
      from reservations r
      join properties p on p.id = r.property_id
      left join guests g on g.id = r.guest_id
     order by r.created_at desc limit 10`,

  notifications: () => sql`
    select n.template, n.channel, n.status, n.locale, n.recipient, n.provider,
           round(extract(epoch from (n.sent_at - n.created_at)) * 1000)::int as latency_ms,
           n.last_error
      from notifications n
     order by n.created_at desc limit 10`,

  events: () => sql`
    select event_type, origin, actor, to_char(at, 'HH24:MI:SS') as at
      from domain_events order by id desc limit 15`,

  schedules: () => sql`
    select name, key, cron, timezone, data->>'propertyId' as property_id
      from pgboss.schedule order by name, key`,
}

const view = process.argv[2] ?? 'reservations'

if (!(view in views)) {
  console.error(`unknown view "${view}". One of: ${Object.keys(views).join(', ')}`)
  await sql.end()
  process.exit(1)
}

console.table(await views[view]())
await sql.end()
