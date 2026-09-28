import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, selectAs, type Fixture } from './support'
import { grantEntitlement } from '../../../onboarding/entitlements'
import { addDays, type DayMovement } from '../../../compliance/istat'
import { localDate } from '../../../compliance/reconcile'
import { runObligation } from '../../../compliance/obligations'
import {
  compareIstatDay,
  createWebturComplianceAdapter,
  generateIstatMovements,
  IstatTransportError,
  webturManualFallback,
  WEBTUR_FVG_ADAPTER_ID,
  type IstatTransport,
} from '../../../compliance/webtur'

/**
 * WP1.3 against a real database: one ISTAT return per day, zero days
 * included, filed through a local fake transport. Nothing reaches WebTur or
 * the Regione; the real route waits for the Regione's specification.
 */

/** Core's own stand-in for the transport (core never imports `@bookone/adapters`). */
class FakeIstatTransport implements IstatTransport {
  readonly channel = 'fake-webtur'
  readonly simulated = true
  readonly days = new Map<string, { reference: string; movement: DayMovement }>()
  failures = 0
  private sequence = 0

  async submitDay(input: { propertyId: string; day: string; movement: DayMovement }) {
    if (this.failures > 0) {
      this.failures -= 1
      throw new IstatTransportError('unavailable', 'injected outage', true)
    }
    this.sequence += 1
    const reference = `FIST-${this.sequence}`
    this.days.set(`${input.propertyId}|${input.day}`, {
      reference,
      movement: structuredClone(input.movement),
    })
    return { reference }
  }

  async readDay(input: { propertyId: string; day: string }) {
    return structuredClone(this.days.get(`${input.propertyId}|${input.day}`)?.movement ?? null)
  }
}

let fixture: Fixture
let transport: FakeIstatTransport
let adapters: Map<string, ReturnType<typeof createWebturComplianceAdapter>>
let yesterday: string
let timeZone: string

async function stay(input: {
  arrival: string
  departure: string
  adults: number
  guests: Record<string, string>[]
}): Promise<string> {
  const propertyId = fixture.alpha.propertyId
  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name) values (${propertyId}, 'Movement guest') returning id`,
  )
  const reference = `M-${randomUUID().slice(0, 6)}`
  const [row] = await db.execute<{ id: string }>(sql`
    insert into reservations (property_id, guest_id, arrival_date, departure_date, status, pax, reference)
    values (${propertyId}, ${guest!.id}, ${input.arrival}, ${input.departure}, 'confirmed',
            ${JSON.stringify({ adults: input.adults, children: 0 })}::jsonb, ${reference})
    returning id`)
  for (const [index, data] of input.guests.entries()) {
    await db.execute(sql`
      insert into registration_records (property_id, reservation_id, guest_index, data)
      values (${propertyId}, ${row!.id}, ${index}, ${JSON.stringify(data)}::jsonb)`)
  }
  return reference
}

async function obligations(propertyId: string) {
  return db.execute<{
    id: string
    period_date: string
    state: string
    last_error: string | null
  }>(sql`
    select id, period_date::text, state, last_error from compliance_obligations
     where property_id = ${propertyId} and type = 'istat_movement' order by period_date`)
}

beforeAll(async () => {
  fixture = await seed()
  for (const property of [fixture.alpha, fixture.beta]) {
    await db.execute(sql`
      update properties
         set settings = settings || '{"jurisdiction": {"region": "IT-36", "comune": "032006"}}'::jsonb,
             timezone = 'Europe/Rome'
       where id = ${property.propertyId}`)
  }
  // Alpha switched the ISTAT return on four days ago; beta never did.
  await grantEntitlement({ propertyId: fixture.alpha.propertyId, feature: 'istat_regional' })
  await db.execute(sql`
    update entitlements set granted_at = now() - interval '4 days'
     where property_id = ${fixture.alpha.propertyId} and feature = 'istat_regional'`)

  timeZone = 'Europe/Rome'
  yesterday = addDays(localDate(new Date(), timeZone), -1)
  transport = new FakeIstatTransport()
  adapters = new Map([[WEBTUR_FVG_ADAPTER_ID, createWebturComplianceAdapter(transport)]])
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('one return per day', () => {
  it('creates a day for every day since the feature, to yesterday, quiet days included, once', async () => {
    const first = await generateIstatMovements({ adapters })
    const second = await generateIstatMovements({ adapters })

    const days = (await obligations(fixture.alpha.propertyId)).map((row) => row.period_date)
    const granted = localDate(new Date(Date.now() - 4 * 86_400_000), timeZone)
    const expected: string[] = []
    for (let day = granted; day <= yesterday; day = addDays(day, 1)) expected.push(day)

    expect(days).toEqual(expected)
    expect(first.created).toBe(expected.length)
    expect(second.created).toBe(0)
    // Beta has no feature: nothing owed through BookOne.
    expect(await obligations(fixture.beta.propertyId)).toEqual([])
  })

  it('files a quiet day as zero, with the counts as the receipt', async () => {
    const [quiet] = await obligations(fixture.alpha.propertyId)
    const [{ deadline }] = (await db.execute<{ deadline: Date }>(
      sql`select deadline from compliance_obligations where id = ${quiet!.id}`,
    )) as unknown as [{ deadline: Date }]
    // Run as the sweep would have, the morning after the day.
    const morning = () => new Date(new Date(deadline).getTime() - 20 * 3_600_000)
    expect(await runObligation({ adapters, now: morning }, quiet!.id)).toMatchObject({
      to: 'acknowledged',
    })
    expect(
      transport.days.get(`${fixture.alpha.propertyId}|${quiet!.period_date}`)?.movement.totals,
    ).toEqual({ arrivals: 0, departures: 0, presences: 0 })

    const [evidence] = await db.execute<{ receipt: Record<string, unknown> }>(
      sql`select receipt from compliance_evidence where obligation_id = ${quiet!.id}`,
    )
    expect(evidence!.receipt).toMatchObject({ presences: 0, arrivals: 0, simulated: true })
  })

  it('hands a day already past its deadline to a person, without filing it', async () => {
    const [, overdue] = await obligations(fixture.alpha.propertyId)
    expect(overdue!.period_date < addDays(yesterday, -1)).toBe(true)
    expect(await runObligation({ adapters }, overdue!.id)).toMatchObject({ to: 'manual' })
    expect(transport.days.has(`${fixture.alpha.propertyId}|${overdue!.period_date}`)).toBe(false)
  })
})

describe('a day with guests', () => {
  it('counts them by origin, and holds a day whose guest has no origin', async () => {
    await stay({
      arrival: yesterday,
      departure: addDays(yesterday, 2),
      adults: 2,
      guests: [{ residenceCountry: 'FR' }, { citizenship: 'DE' }],
    })
    const incomplete = await stay({
      arrival: yesterday,
      departure: addDays(yesterday, 1),
      adults: 1,
      guests: [],
    })

    const day = (await obligations(fixture.alpha.propertyId)).find(
      (row) => row.period_date === yesterday,
    )!
    await runObligation({ adapters }, day.id)
    const held = (await obligations(fixture.alpha.propertyId)).find((row) => row.id === day.id)!
    expect(held.state).toBe('pending')
    expect(held.last_error).toContain(
      `Stay ${incomplete}: a guest's residence or citizenship is not recorded`,
    )
    expect(transport.days.has(`${fixture.alpha.propertyId}|${yesterday}`)).toBe(false)

    // The desk records the missing guest; the day files.
    await db.execute(sql`
      insert into registration_records (property_id, reservation_id, guest_index, data)
      select ${fixture.alpha.propertyId}, id, 0, '{"citizenship": "AT"}'::jsonb
        from reservations where reference = ${incomplete}`)
    await runObligation({ adapters }, day.id)
    expect(
      (await obligations(fixture.alpha.propertyId)).find((row) => row.id === day.id)!.state,
    ).toBe('acknowledged')
    const filed = transport.days.get(`${fixture.alpha.propertyId}|${yesterday}`)!.movement
    expect(filed.byOrigin).toEqual({
      FR: { arrivals: 1, departures: 0, presences: 1 },
      DE: { arrivals: 1, departures: 0, presences: 1 },
      AT: { arrivals: 1, departures: 0, presences: 1 },
    })
    expect(filed.roomsOccupied).toBe(2)
    expect(filed.byCitizenship).toBe(2)
  })

  it('builds the fallback file from the same series', async () => {
    const fallback = await webturManualFallback(fixture.alpha.propertyId, yesterday)
    expect(fallback.content.split('\r\n')).toEqual([
      'giorno;provenienza;arrivi;partenze;presenze',
      `${yesterday};AT;1;0;1`,
      `${yesterday};DE;1;0;1`,
      `${yesterday};FR;1;0;1`,
      `${yesterday};TOTALE;3;0;3`,
      `${yesterday};CAMERE_OCCUPATE;;;2`,
      '',
    ])
  })

  it('shows what changed when the portal no longer matches what we filed', async () => {
    const key = `${fixture.alpha.propertyId}|${yesterday}`
    const input = { propertyId: fixture.alpha.propertyId, day: yesterday }
    expect(await compareIstatDay(transport, input)).toEqual({ theirs: 'present', differences: [] })

    transport.days.get(key)!.movement.byOrigin.FR!.presences = 2
    expect(await compareIstatDay(transport, input)).toEqual({
      theirs: 'present',
      differences: [{ origin: 'FR', field: 'presences', ours: 1, theirs: 2 }],
    })
    expect(
      await compareIstatDay(transport, { propertyId: fixture.beta.propertyId, day: yesterday }),
    ).toEqual({ theirs: 'missing', differences: [] })
  })
})

describe('when WebTur is down', () => {
  it('retries, then hands the day to a person near the deadline', async () => {
    const row = (await obligations(fixture.alpha.propertyId)).find(
      (candidate) => candidate.state === 'pending',
    )!
    const [{ deadline }] = (await db.execute<{ deadline: Date }>(
      sql`select deadline from compliance_obligations where id = ${row.id}`,
    )) as unknown as [{ deadline: Date }]
    transport.failures = 10
    const end = new Date(deadline).getTime()

    expect(
      await runObligation({ adapters, now: () => new Date(end - 20 * 3_600_000) }, row.id),
    ).toMatchObject({ to: 'failed' })
    expect(
      await runObligation({ adapters, now: () => new Date(end - 2 * 3_600_000) }, row.id),
    ).toMatchObject({ to: 'manual' })
    transport.failures = 0
  })
})

describe('isolation', () => {
  it('shows another property none of alpha’s returns', async () => {
    const rows = (await selectAs(
      fixture.beta.user,
      'compliance_obligations',
      'select=id&type=eq.istat_movement',
    )) as unknown[]
    expect(rows).toEqual([])
    const own = (await selectAs(
      fixture.alpha.user,
      'compliance_obligations',
      'select=id&type=eq.istat_movement',
    )) as unknown[]
    expect(own.length).toBeGreaterThan(0)
  })
})
