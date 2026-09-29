import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '@bookone/core/db'
import { respondToOwner } from './owner'

/**
 * The owner's assistant against a real database (WP0.5 acceptance): the owner
 * asks "quanti arrivi domani?" and gets the answer; the same words from a guest's
 * number reach nothing here. Own property, deleted afterwards.
 */
const slug = `owner-${randomUUID().slice(0, 8)}`
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const dayAfter = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
let propertyId: string

beforeAll(async () => {
  const [property] = await db.execute<{ id: string }>(
    sql`insert into properties (slug, name, settings)
        values (${slug}, 'Owner Test', '{}'::jsonb) returning id`,
  )
  propertyId = property!.id
  await db.execute(
    sql`insert into property_contacts (property_id, role, name, phone)
        values (${propertyId}, 'owner', 'Owner', '+390400000001')`,
  )

  await db.execute(
    sql`insert into entitlements (property_id, feature) values (${propertyId}, 'concierge')`,
  )

  const [guest] = await db.execute<{ id: string }>(
    sql`insert into guests (property_id, name) values (${propertyId}, 'Marco Rossi') returning id`,
  )
  await db.execute(
    sql`insert into reservations (property_id, guest_id, arrival_date, departure_date, status)
        values (${propertyId}, ${guest!.id}, ${tomorrow}, ${dayAfter}, 'confirmed')`,
  )
})

afterAll(async () => {
  await db.execute(sql`delete from domain_events where property_id = ${propertyId}`)
  await db.execute(sql`delete from agent_runs where property_id = ${propertyId}`)
  await db.execute(sql`delete from properties where id = ${propertyId}`)
  await closeConnection()
})

describe("the owner's assistant", () => {
  it('answers the owner from the property’s own rows', async () => {
    const outcome = await respondToOwner({
      propertyId,
      phone: '0039 040 000 0001',
      message: 'Quanti arrivi domani?',
      locale: 'it',
    })

    expect(outcome.status).toBe('answered')
    expect(outcome.status === 'answered' && outcome.reply).toContain('Marco Rossi')
  })

  it('refuses a number that is not the owner’s, before anything runs', async () => {
    const before = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs where property_id = ${propertyId}`,
    )

    const outcome = await respondToOwner({
      propertyId,
      phone: '+39 333 1234567',
      message: 'Quanti arrivi domani?',
      locale: 'it',
    })

    expect(outcome).toEqual({ status: 'refused', reason: 'not a recorded owner number' })
    const after = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs where property_id = ${propertyId}`,
    )
    expect(after[0]!.n).toBe(before[0]!.n)
  })
})
