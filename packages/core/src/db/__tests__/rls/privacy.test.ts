import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection, db } from '../../client'
import { withUser } from '../../session'
import { createUser, expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import { buildGuestExport } from '../../../privacy/export'
import { eraseGuest } from '../../../privacy/erasure'
import { runRetention } from '../../../privacy/retention'
import { listRequests, overdueCount, raiseRequest, resolveRequest } from '../../../privacy/requests'
import { DATA_MAP } from '../../../privacy/data-map'

/**
 * GDPR export, erasure and retention against a real database (E8.1, E8.2).
 *
 * These cannot be unit tests. Every one of them is a claim about what is left
 * in Postgres afterwards, and the failure mode throughout is a column somebody
 * forgot — which produces no error anywhere, only a row still holding a name.
 *
 * The centrepiece is `leaves nothing of the person behind`: it plants a
 * distinctive name, email and phone number in every table that can hold one,
 * erases, and then searches **every text and jsonb column in the schema** for
 * them. That is the only version of this assertion worth writing, because the
 * plausible version — checking the four tables the author remembered — passes
 * in exactly the situation the feature exists to prevent.
 */

let fixture: Fixture

/** Distinctive enough that a match anywhere is this guest and not a fixture. */
const NEEDLES = {
  name: 'Zerlinda Quatrocchi',
  email: 'zerlinda.quatrocchi@example.invalid',
  phone: '+39 055 0000191',
}

beforeAll(async () => {
  fixture = await seed()
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

async function guestOf(propertyId: string): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`select id from guests where property_id = ${propertyId} limit 1`,
  )

  return row!.id
}

describe('the request desk is isolated, and narrower than the console', () => {
  it('shows an owner only their own property’s requests', async () => {
    const alphaGuest = await guestOf(fixture.alpha.propertyId)
    const betaGuest = await guestOf(fixture.beta.propertyId)

    await raiseRequest({
      propertyId: fixture.alpha.propertyId,
      guestId: alphaGuest,
      kind: 'export',
      requestedBy: fixture.alpha.user.id,
    })

    await raiseRequest({
      propertyId: fixture.beta.propertyId,
      guestId: betaGuest,
      kind: 'erasure',
      requestedBy: fixture.beta.user.id,
    })

    // Client path: PostgREST with alpha's own JWT.
    const rows = (await selectAs(fixture.alpha.user, 'privacy_requests')) as {
      property_id: string
    }[]

    expect(rows).toHaveLength(1)
    expect(rows[0]!.property_id).toBe(fixture.alpha.propertyId)

    // Application path: the same question through Drizzle, where the connection
    // holds BYPASSRLS and only `withUser` gives it up (ADR-018).
    const viaDrizzle = await withUser(fixture.alpha.user.id, (tx) =>
      tx.execute(sql`select property_id from privacy_requests`),
    )

    expect(viaDrizzle).toHaveLength(1)
  })

  it('hides them from staff, who are members but not owners', async () => {
    /*
     * The narrowing that is about the *subject* rather than the property.
     *
     * A privacy request records that a named guest asked to be forgotten. The
     * receptionist who checked them in has no reason to hold that fact, and
     * E5.5 does not put this surface in their console. The policy is what makes
     * that true — a hidden nav item is not a permission.
     */
    const staff = await createUser(`staff-${Date.now()}@bookone.test`)

    await db.execute(sql`
      insert into property_members (property_id, user_id, role)
      values (${fixture.alpha.propertyId}, ${staff.id}, 'staff')
    `)

    const rows = await selectAs(staff, 'privacy_requests')

    // Zero rows, not an error. An error would mean the policy was never
    // exercised and the query was simply wrong.
    expect(rows).toEqual([])
  })

  it('refuses a session that tries to write one', async () => {
    const guestId = await guestOf(fixture.alpha.propertyId)

    const message = await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into privacy_requests (property_id, guest_id, kind, due_by)
          values (${fixture.alpha.propertyId}, ${guestId}, 'erasure', now() + interval '30 days')
        `),
      ),
    )

    expect(message).toContain('privacy_requests')
  })
})

describe('the deadline', () => {
  it('is thirty days from the row’s own clock, not the process’s', async () => {
    const guestId = await guestOf(fixture.beta.propertyId)

    const id = await raiseRequest({
      propertyId: fixture.beta.propertyId,
      guestId,
      kind: 'export',
      requestedBy: fixture.beta.user.id,
    })

    const [row] = await db.execute<{ gap: number }>(sql`
      select extract(epoch from (due_by - created_at)) as gap
      from privacy_requests where id = ${id}
    `)

    /*
     * Exactly thirty days, to the microsecond.
     *
     * Both come from one `now()` in one statement. Computing `due_by` in the
     * application would put it a few hundred milliseconds off — the check
     * constraint would still pass, nobody would notice, and the one column that
     * answers "did you respond in time" would be quietly approximate. This
     * codebase has already had two bugs from exactly that gap.
     */
    expect(Number(row!.gap)).toBe(30 * 86_400)
  })

  it('counts an overdue request once it is late, and stops when it is answered', async () => {
    const guestId = await guestOf(fixture.beta.propertyId)

    const id = await raiseRequest({
      propertyId: fixture.beta.propertyId,
      guestId,
      kind: 'erasure',
      requestedBy: fixture.beta.user.id,
    })

    await db.execute(
      // `created_at` moves too: `due_by > created_at` is a check constraint,
      // and it applies to updates as well as inserts.
      sql`update privacy_requests
          set created_at = now() - interval '31 days', due_by = now() - interval '1 day'
          where id = ${id}`,
    )

    expect(await overdueCount(fixture.beta.propertyId)).toBe(1)

    expect(
      await resolveRequest({
        propertyId: fixture.beta.propertyId,
        requestId: id,
        status: 'completed',
        outcome: { applied: {} },
        actor: { kind: 'user', userId: fixture.beta.user.id },
      }),
    ).toBe(true)

    expect(await overdueCount(fixture.beta.propertyId)).toBe(0)
  })

  it('closes once, so two owners pressing together produce one completion', async () => {
    const guestId = await guestOf(fixture.beta.propertyId)

    const id = await raiseRequest({
      propertyId: fixture.beta.propertyId,
      guestId,
      kind: 'export',
      requestedBy: fixture.beta.user.id,
    })

    const resolve = () =>
      resolveRequest({
        propertyId: fixture.beta.propertyId,
        requestId: id,
        status: 'completed',
        outcome: {},
        actor: { kind: 'user', userId: fixture.beta.user.id },
      })

    expect(await resolve()).toBe(true)
    // The second must be able to tell it did nothing. An erasure applied twice
    // is harmless; one *reported* twice makes the deadline evidence wrong.
    expect(await resolve()).toBe(false)
  })

  it('sorts open requests to the top, nearest deadline first', async () => {
    const rows = await listRequests(fixture.beta.propertyId)
    const open = rows.filter((row) => row.status === 'open')

    expect(rows.slice(0, open.length).every((row) => row.status === 'open')).toBe(true)
  })
})

/**
 * One guest with something in every table that can hold a guest.
 *
 * Written with raw SQL rather than through the domain functions: this fixture
 * has to be *complete*, and building it through the product would only ever
 * reach the tables the product currently writes — which is the same blind spot
 * the test is checking for.
 */
async function plantGuest(propertyId: string): Promise<{ guestId: string; stayId: string }> {
  const [guest] = await db.execute<{ id: string }>(sql`
    insert into guests (property_id, name, email, phone, locale, marketing_consent)
    values (${propertyId}, ${NEEDLES.name}, ${NEEDLES.email}, ${NEEDLES.phone}, 'it', true)
    returning id
  `)

  const [roomType] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} limit 1`,
  )

  const [stay] = await db.execute<{ id: string }>(sql`
    insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date,
                              status, total_cents, reference, engine_session_id)
    values (${propertyId}, ${guest!.id}, ${roomType!.id}, '2026-05-01', '2026-05-04',
            'confirmed', 42000, ${'ZQ-' + Date.now()}, 'sess-zq')
    returning id
  `)

  const guestId = guest!.id
  const stayId = stay!.id

  await db.execute(sql`
    insert into journey_states (reservation_id, property_id) values (${stayId}, ${propertyId})
  `)

  const [record] = await db.execute<{ id: string }>(sql`
    insert into registration_records (property_id, reservation_id, guest_index, data, document_path)
    values (${propertyId}, ${stayId}, 0,
            ${JSON.stringify({ surname: 'Quatrocchi', name: 'Zerlinda', document: 'AY1234567' })}::jsonb,
            ${'docs/' + stayId + '/0.jpg'})
    returning id
  `)

  await db.execute(sql`
    insert into alloggiati_submissions (property_id, reservation_id, status, guest_count, payload,
                                        payload_checksum, channel, submitted_at, acknowledged_at,
                                        receipt)
    values (${propertyId}, ${stayId}, 'acknowledged', 1,
            ${'16' + NEEDLES.name}, 'abc123', 'mock', now(), now(), '{"id":"r1"}'::jsonb)
  `)

  await db.execute(sql`
    insert into payments (property_id, reservation_id, kind, status, amount_cents, provider, simulated)
    values (${propertyId}, ${stayId}, 'deposit', 'succeeded', 12000, 'mock', true)
  `)

  await db.execute(sql`
    insert into stay_extras (property_id, reservation_id, description, amount_cents, source)
    values (${propertyId}, ${stayId}, 'Minibar', 800, 'platform')
  `)

  await db.execute(sql`
    insert into invoice_requests (property_id, reservation_id, bill_to, details)
    values (${propertyId}, ${stayId}, ${NEEDLES.name}, ${JSON.stringify({ vat: 'IT01234567890' })}::jsonb)
  `)

  await db.execute(sql`
    insert into attribution_events (property_id, session_id, channel, reservation_id, occurred_at)
    values (${propertyId}, 'sess-zq', 'concierge_chat', ${stayId}, now() - interval '1 hour')
  `)

  await db.execute(sql`
    insert into notifications (property_id, reservation_id, channel, template, locale, recipient, payload)
    values (${propertyId}, ${stayId}, 'email', 'booking.confirmed', 'it', ${NEEDLES.email},
            ${JSON.stringify({ name: NEEDLES.name })}::jsonb)
  `)

  const [run] = await db.execute<{ id: string }>(sql`
    insert into agent_runs (agent, property_id, tool_calls, output, tier_applied)
    values ('AG-01', ${propertyId}, ${JSON.stringify([{ tool: 'searchKb', args: { q: NEEDLES.name } }])}::jsonb,
            ${JSON.stringify({ reply: 'Buongiorno ' + NEEDLES.name })}::jsonb, 'T1')
    returning id
  `)

  const [thread] = await db.execute<{ id: string }>(sql`
    insert into message_threads (property_id, reservation_id, locale, escalation_reason)
    values (${propertyId}, ${stayId}, 'it', ${'asked about ' + NEEDLES.name})
    returning id
  `)

  await db.execute(sql`
    insert into messages (property_id, thread_id, author, body)
    values (${propertyId}, ${thread!.id}, 'guest', ${'Sono ' + NEEDLES.name + ', ' + NEEDLES.phone})
  `)

  await db.execute(sql`
    insert into messages (property_id, thread_id, author, body, agent_run_id)
    values (${propertyId}, ${thread!.id}, 'agent', 'Buongiorno.', ${run!.id})
  `)

  await db.execute(sql`
    insert into stay_tasks (property_id, reservation_id, thread_id, summary, created_by)
    values (${propertyId}, ${stayId}, ${thread!.id}, ${'Late check-in for ' + NEEDLES.name},
            'agent:AG-01')
  `)

  // A discrepancy naming the reservation, with the guest in both snapshots.
  const [run2] = await db.execute<{ id: string }>(sql`
    insert into reconciliation_runs (property_id, domain, parity_ratio, compared_count,
                                     discrepancies_count)
    values (${propertyId}, 'booking', 0.99, 10, 1)
    returning id
  `)

  await db.execute(sql`
    insert into discrepancies (property_id, run_id, entity_ref, class, ours, theirs)
    values (${propertyId}, ${run2!.id}, ${'reservation:' + stayId}, 'logic',
            ${JSON.stringify({ guest: NEEDLES.name })}::jsonb,
            ${JSON.stringify({ guest: NEEDLES.name })}::jsonb)
  `)

  // Events about the guest, the stay, and one about a registration record —
  // the third is the one a reservation-only sweep would miss.
  for (const [entityType, entityId] of [
    ['guest', guestId],
    ['reservation', stayId],
    ['registration_record', record!.id],
  ] as const) {
    await db.execute(sql`
      insert into domain_events (property_id, entity_type, entity_id, event_type, payload, origin, actor)
      values (${propertyId}, ${entityType}, ${entityId}, 'reservation.confirmed',
              ${JSON.stringify({ guest: NEEDLES.name, email: NEEDLES.email })}::jsonb,
              'platform', 'system')
    `)
  }

  return { guestId, stayId }
}

/**
 * Searches every text and jsonb column in the public schema for a string.
 *
 * Reads `information_schema` rather than a list, so a table added next sprint
 * is searched without anybody remembering to add it here. Returns
 * `table.column` for every hit.
 */
async function findAnywhere(needle: string): Promise<string[]> {
  const columns = await db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'jsonb')
    order by table_name, column_name
  `)

  const hits: string[] = []

  const pattern = `%${needle.replace(/'/g, "''")}%`

  for (const column of columns) {
    const [row] = await db.execute<{ n: number }>(
      sql.raw(
        `select count(*)::int as n from public."${column.table_name}" ` +
          `where "${column.column_name}"::text like '${pattern}'`,
      ),
    )

    if (Number(row?.n ?? 0) > 0) hits.push(`${column.table_name}.${column.column_name}`)
  }

  return hits
}

describe('the export bundle', () => {
  it('reaches every table the data map says it should, and names the ones it does not', async () => {
    const { guestId } = await plantGuest(fixture.alpha.propertyId)

    const bundle = await buildGuestExport({
      propertyId: fixture.alpha.propertyId,
      guestId,
    })

    // The manifest covers the whole map, not only what had rows. "We hold
    // nothing about you here" and "we did not look here" produce identical
    // exports without this.
    expect(bundle.manifest).toHaveLength(DATA_MAP.length)

    const included = bundle.manifest
      .filter((line) => line.state === 'included')
      .map((line) => line.table)
      .sort()

    expect(included).toEqual(
      [
        'alloggiati_submissions',
        'attribution_events',
        'guests',
        'invoice_requests',
        'journey_states',
        'message_threads',
        'messages',
        'notifications',
        'payments',
        'registration_records',
        'reservations',
        'stay_extras',
        'stay_tasks',
      ].sort(),
    )

    // Excluded, with a reason a data subject can read — not silence.
    const events = bundle.manifest.find((line) => line.table === 'domain_events')!
    expect(events.state).toBe('excluded')
    expect(events.note).toMatch(/audit log/)
  })

  it('withholds the storage path while including the record it belongs to', async () => {
    const guestId = (
      await db.execute<{ id: string }>(
        sql`select id from guests where email = ${NEEDLES.email} limit 1`,
      )
    )[0]!.id

    const bundle = await buildGuestExport({ propertyId: fixture.alpha.propertyId, guestId })
    const records = bundle.data.registration_records as Record<string, unknown>[]

    expect(records).toHaveLength(1)
    // Handing over a path into a private bucket tells the subject nothing and
    // tells anybody else who reads the file how our storage is laid out.
    expect(records[0]).not.toHaveProperty('documentPath')
    expect(records[0]).toHaveProperty('data')
  })

  it('refuses a guest belonging to another property', async () => {
    const betaGuest = await guestOf(fixture.beta.propertyId)

    await expect(
      buildGuestExport({ propertyId: fixture.alpha.propertyId, guestId: betaGuest }),
    ).rejects.toThrow(/No such guest/)
  })
})

describe('erasure', () => {
  it('leaves nothing of the person behind', async () => {
    const guestId = (
      await db.execute<{ id: string }>(
        sql`select id from guests where email = ${NEEDLES.email} limit 1`,
      )
    )[0]!.id

    // Before: the planted data is findable, or this test proves nothing.
    expect((await findAnywhere(NEEDLES.name)).length).toBeGreaterThan(5)

    const deleted: string[] = []

    const outcome = await eraseGuest(
      {
        deleteObject: async (path) => {
          deleted.push(path)
          return true
        },
      },
      {
        propertyId: fixture.alpha.propertyId,
        guestId,
        actor: { kind: 'user', userId: fixture.alpha.user.id },
      },
    )

    expect(deleted).toHaveLength(1)
    expect(outcome.documents).toEqual({ deleted: 1, failed: 0 })

    /*
     * The assertion the whole feature is for.
     *
     * Every text and jsonb column in the schema, searched for the name, the
     * email and the phone number. Not the four tables the author remembered —
     * that version of this test passes in precisely the situation this one is
     * written to catch.
     */
    /*
     * Exactly one place, and it is the declared carve-out.
     *
     * The Alloggiati payload is the transmitted text of a filing with a public
     * authority. It names every guest in the party, so honouring one person's
     * request by deleting it would destroy another person's record and the
     * property's compliance evidence together — Art. 17(3)(b), and the two-year
     * retention clock is what removes it.
     *
     * Asserted as an exact list rather than an empty one on purpose. An empty
     * assertion would have to be weakened the moment a lawful carve-out exists,
     * and a weakened assertion is how the next unlawful residue gets through.
     * This way every new hit is a test failure that has to be argued for.
     *
     * `invoice_requests.bill_to` was in this list on the first run. It was not
     * a lawful carve-out — our row is a routing record, not the fiscal document
     * — and the map was wrong rather than the test.
     */
    expect(await findAnywhere(NEEDLES.name)).toEqual(['alloggiati_submissions.payload'])

    // Neither of these appears in a filing, so both must be gone entirely.
    expect(await findAnywhere(NEEDLES.email)).toEqual([])
    expect(await findAnywhere(NEEDLES.phone)).toEqual([])
  })

  it('keeps the transaction, and says which carve-out kept it', async () => {
    const [reservation] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from reservations where engine_session_id = 'sess-zq'
    `)

    // Art. 17(3)(b). The person is gone; the stay, the payment and the filing
    // are not, and the desk showed the owner exactly this before the button.
    expect(Number(reservation!.n)).toBe(1)

    const [payment] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from payments p
      join reservations r on r.id = p.reservation_id
      where r.engine_session_id = 'sess-zq'
    `)

    expect(Number(payment!.n)).toBe(1)
  })

  it('records that it happened, in an event that outlives what it erased', async () => {
    const [event] = await db.execute<{ payload: Record<string, unknown>; actor: string }>(sql`
      select payload, actor from domain_events
      where event_type = 'guest.erased' and property_id = ${fixture.alpha.propertyId}
      order by id desc limit 1
    `)

    expect(event).toBeDefined()
    expect(event!.actor).toBe(`user:${fixture.alpha.user.id}`)

    // Counts and carve-out names. Nothing that names the person the request was
    // about — this row has to be safe to keep after erasing them.
    expect(event!.payload.carveOuts).toContain('reservations')
    expect(JSON.stringify(event!.payload)).not.toContain(NEEDLES.name)
  })

  it('touches nothing at another property', async () => {
    const [beta] = await db.execute<{ name: string | null }>(
      sql`select name from guests where property_id = ${fixture.beta.propertyId} limit 1`,
    )

    expect(beta!.name).toBe('hotel-beta guest')
  })
})

describe('the retention sweep', () => {
  it('purges a registration record thirty days after the guest left', async () => {
    const [roomType] = await db.execute<{ id: string }>(
      sql`select id from room_types where property_id = ${fixture.beta.propertyId} limit 1`,
    )

    const [guest] = await db.execute<{ id: string }>(sql`
      insert into guests (property_id, name) values (${fixture.beta.propertyId}, 'Old Stay')
      returning id
    `)

    const [stay] = await db.execute<{ id: string }>(sql`
      insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date,
                                status)
      values (${fixture.beta.propertyId}, ${guest!.id}, ${roomType!.id},
              current_date - 100, current_date - 97, 'confirmed')
      returning id
    `)

    await db.execute(sql`
      insert into registration_records (property_id, reservation_id, guest_index, data)
      values (${fixture.beta.propertyId}, ${stay!.id}, 0, '{"surname":"Old"}'::jsonb)
    `)

    const first = await runRetention({ propertyId: fixture.beta.propertyId })
    const records = first.results.find((result) => result.table === 'registration_records')!

    expect(records.affected).toBe(1)
    expect(records.error).toBeUndefined()

    const [row] = await db.execute<{ data: unknown; deleted_at: Date | null }>(sql`
      select data, deleted_at from registration_records where reservation_id = ${stay!.id}
    `)

    expect(row!.data).toEqual({})
    expect(row!.deleted_at).not.toBeNull()

    /*
     * Idempotence, and it is not cosmetic.
     *
     * Without the "still has something to purge" predicate the same rows are
     * reported every night forever, and the count in the retention event stops
     * being a count of anything.
     */
    const second = await runRetention({ propertyId: fixture.beta.propertyId })
    expect(second.results.find((result) => result.table === 'registration_records')!.affected).toBe(
      0,
    )
  })

  it('blanks an Alloggiati payload two years after acknowledgement, keeping the receipt', async () => {
    await db.execute(sql`
      update alloggiati_submissions
      set acknowledged_at = now() - interval '3 years'
      where property_id = ${fixture.alpha.propertyId}
    `)

    const outcome = await runRetention({ propertyId: fixture.alpha.propertyId })
    const submissions = outcome.results.find((result) => result.table === 'alloggiati_submissions')!

    expect(submissions.affected).toBe(1)

    const [row] = await db.execute<{
      payload: string
      payload_purged_at: Date | null
      receipt: unknown
      payload_checksum: string
    }>(sql`
      select payload, payload_purged_at, receipt, payload_checksum
      from alloggiati_submissions where property_id = ${fixture.alpha.propertyId}
    `)

    expect(row!.payload).toBe('')
    expect(row!.payload_purged_at).not.toBeNull()
    // What proves the filing happened, without repeating who was in it.
    expect(row!.receipt).toEqual({ id: 'r1' })
    expect(row!.payload_checksum).toBe('abc123')
  })

  it('deletes a ten-year-old reservation through its restricting children', async () => {
    /*
     * The rule that could not run.
     *
     * `payments`, `fee_events` and `alloggiati_submissions` are `restrict` on
     * a reservation, so a plain delete throws — in a scheduled job, at 04:00,
     * having removed nothing. The map declares them as dependents and the sweep
     * clears them first; this is the test that the declaration and the database
     * agree.
     */
    const [roomType] = await db.execute<{ id: string }>(
      sql`select id from room_types where property_id = ${fixture.beta.propertyId} limit 1`,
    )

    const [guest] = await db.execute<{ id: string }>(sql`
      insert into guests (property_id, name) values (${fixture.beta.propertyId}, 'Ancient')
      returning id
    `)

    const [stay] = await db.execute<{ id: string }>(sql`
      insert into reservations (property_id, guest_id, room_type_id, arrival_date, departure_date,
                                status, created_at)
      values (${fixture.beta.propertyId}, ${guest!.id}, ${roomType!.id},
              '2015-01-01', '2015-01-03', 'confirmed', now() - interval '11 years')
      returning id
    `)

    await db.execute(sql`
      insert into payments (property_id, reservation_id, kind, status, amount_cents, provider, simulated)
      values (${fixture.beta.propertyId}, ${stay!.id}, 'balance', 'succeeded', 9000, 'mock', true)
    `)

    await db.execute(sql`
      insert into fee_events (property_id, reservation_id, kind, basis_cents, rate_bps, fee_cents, evidence)
      values (${fixture.beta.propertyId}, ${stay!.id}, 'direct_booking', 9000, 150, 135, '{}'::jsonb)
    `)

    await db.execute(sql`
      insert into external_refs (property_id, system, entity_type, entity_id, external_id)
      values (${fixture.beta.propertyId}, 'ericsoft', 'reservation', ${stay!.id}, 'E-OLD-1')
    `)

    const outcome = await runRetention({ propertyId: fixture.beta.propertyId })
    const reservations = outcome.results.find((result) => result.table === 'reservations')!

    expect(reservations.error).toBeUndefined()
    expect(reservations.affected).toBe(1)

    const [remaining] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from reservations where id = ${stay!.id}`,
    )
    expect(Number(remaining!.n)).toBe(0)

    // And the external reference, which no foreign key would have removed.
    const [refs] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from external_refs where entity_id = ${stay!.id}`,
    )
    expect(Number(refs!.n)).toBe(0)
  })

  it('scopes every statement to one property', async () => {
    /*
     * Binding rule 3 does not relax under the service role.
     *
     * Alpha's registration records are well inside their retention window;
     * running beta's sweep must not touch them, and the way this goes wrong is
     * a predicate that forgets `property_id` — which nothing else would notice
     * until a hotel lost data they still needed.
     */
    const [before] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from reservations where property_id = ${fixture.alpha.propertyId}
    `)

    await runRetention({ propertyId: fixture.beta.propertyId })

    const [after] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from reservations where property_id = ${fixture.alpha.propertyId}
    `)

    expect(Number(after!.n)).toBe(Number(before!.n))
  })

  it('changes nothing on a dry run, and counts the same rows', async () => {
    const [guest] = await db.execute<{ id: string }>(sql`
      insert into guests (property_id, name, email, created_at)
      values (${fixture.beta.propertyId}, 'Very Old', 'veryold@example.invalid',
              now() - interval '11 years')
      returning id
    `)

    const dry = await runRetention({ propertyId: fixture.beta.propertyId, dryRun: true })
    const dryGuests = dry.results.find((result) => result.table === 'guests')!

    expect(dryGuests.affected).toBeGreaterThan(0)

    const [still] = await db.execute<{ email: string | null }>(
      sql`select email from guests where id = ${guest!.id}`,
    )

    expect(still!.email).toBe('veryold@example.invalid')

    const wet = await runRetention({ propertyId: fixture.beta.propertyId })
    expect(wet.results.find((result) => result.table === 'guests')!.affected).toBe(
      dryGuests.affected,
    )

    const [purged] = await db.execute<{ email: string | null; name: string | null }>(
      sql`select email, name from guests where id = ${guest!.id}`,
    )

    expect(purged!.email).toBeNull()
    expect(purged!.name).toBe('—')
  })
})
