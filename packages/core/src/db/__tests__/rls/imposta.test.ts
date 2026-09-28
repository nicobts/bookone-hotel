import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import { declarationForProperty, reconcileDeclaration } from '../../../compliance/imposta'

/**
 * WP1.4 against a real database: a property's declaration built from its own
 * confirmed stays and registration records, under a fictional comune's rules
 * (`999001`). Nothing is collected and nothing is filed.
 */
let fixture: Fixture

async function stay(input: {
  reference: string
  arrival: string
  departure: string
  adults: number
  guests: Record<string, string>[]
  status?: string
}) {
  const propertyId = fixture.alpha.propertyId
  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name) values (${propertyId}, 'Tax guest') returning id`,
  )
  const [row] = await db.execute<{ id: string }>(sql`
    insert into reservations (property_id, guest_id, arrival_date, departure_date, status, pax, reference)
    values (${propertyId}, ${guest!.id}, ${input.arrival}, ${input.departure}, ${input.status ?? 'confirmed'},
            ${JSON.stringify({ adults: input.adults, children: 0 })}::jsonb, ${input.reference})
    returning id`)
  for (const [index, data] of input.guests.entries()) {
    await db.execute(sql`
      insert into registration_records (property_id, reservation_id, guest_index, data)
      values (${propertyId}, ${row!.id}, ${index}, ${JSON.stringify(data)}::jsonb)`)
  }
}

beforeAll(async () => {
  fixture = await seed()
  await db.execute(sql`
    update properties
       set settings = settings || '{"jurisdiction": {"region": "IT-36", "comune": "999001"}, "accommodationCategory": "hotel-3"}'::jsonb
     where id = ${fixture.alpha.propertyId}`)

  // Two adults in high season; a teen at half rate; a resident; a cancelled stay.
  await stay({
    reference: 'T-1',
    arrival: '2026-06-10',
    departure: '2026-06-12',
    adults: 2,
    guests: [{ birthDate: '1980-01-01' }, { birthDate: '1982-02-02' }],
  })
  await stay({
    reference: 'T-2',
    arrival: '2026-06-01',
    departure: '2026-06-04',
    adults: 1,
    guests: [{ birthDate: '2011-03-01' }],
  })
  await stay({
    reference: 'T-3',
    arrival: '2026-06-20',
    departure: '2026-06-22',
    adults: 1,
    guests: [{ birthDate: '1970-01-01', taxExemption: 'residente' }],
  })
  await stay({
    reference: 'T-4',
    arrival: '2026-06-15',
    departure: '2026-06-18',
    adults: 2,
    guests: [],
    status: 'cancelled',
  })
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('a property’s declaration', () => {
  it('is built from its confirmed stays and records, under its comune’s rules', async () => {
    const result = await declarationForProperty(fixture.alpha.propertyId, {
      from: '2026-06-01',
      to: '2026-06-30',
    })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    const { declaration } = result
    expect(declaration.comune).toBe('999001')
    expect(declaration.lines.map((line) => [line.reference, line.amountCents])).toEqual([
      ['T-2', 450], // 3 × 1,50, 15 at arrival
      ['T-1', 1200], // 2 × 2 × 3,00
      ['T-3', 0], // resident, declared
    ])
    expect(declaration.totals).toMatchObject({
      persons: 4,
      taxableNights: 4,
      reducedNights: 3,
      exemptNights: { residente: 2 },
      amountCents: 1650,
    })
    expect(declaration.issues).toEqual([])

    expect(
      reconcileDeclaration(declaration, [
        { reference: 'T-1', amountCents: 1200 },
        { reference: 'T-2', amountCents: 450 },
      ]).reconciles,
    ).toBe(true)
  })

  it('has nothing to compute for a comune without rules, or without a category', async () => {
    await db.execute(sql`
      update properties
         set settings = settings || '{"jurisdiction": {"region": "IT-36", "comune": "999999"}}'::jsonb
       where id = ${fixture.beta.propertyId}`)
    expect(
      await declarationForProperty(fixture.beta.propertyId, {
        from: '2026-06-01',
        to: '2026-06-30',
      }),
    ).toEqual({ status: 'no-rules', comune: '999999' })

    await db.execute(sql`
      update properties
         set settings = settings || '{"jurisdiction": {"region": "IT-36", "comune": "999001"}}'::jsonb
       where id = ${fixture.beta.propertyId}`)
    expect(
      await declarationForProperty(fixture.beta.propertyId, {
        from: '2026-06-01',
        to: '2026-06-30',
      }),
    ).toEqual({ status: 'no-category' })
  })

  it('reads only its own property’s stays', async () => {
    await db.execute(sql`
      update properties set settings = settings || '{"accommodationCategory": "hotel-3"}'::jsonb
       where id = ${fixture.beta.propertyId}`)
    const beta = await declarationForProperty(fixture.beta.propertyId, {
      from: '2026-06-01',
      to: '2026-06-30',
    })
    expect(beta).toMatchObject({ status: 'ready', declaration: { lines: [] } })
  })
})
