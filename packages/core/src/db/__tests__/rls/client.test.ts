import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeConnection } from '../../client'
import { reset, seed, selectAs, type Fixture } from './support'

/**
 * Isolation on the **client access path** — PostgREST with a real user JWT.
 *
 * This is the path an attacker takes: the anon key is public, it ships in every
 * browser bundle, and the REST endpoint is reachable by anyone who reads it.
 * The policies are all that stand there.
 *
 * The companion suite (`session.test.ts`) covers the application's own path.
 * Neither substitutes for the other — they authenticate differently, and the
 * gap between them is what ADR-018 exists to close.
 */

let fx: Fixture

beforeAll(async () => {
  fx = await seed()
}, 60_000)

afterAll(async () => {
  await reset()
  await closeConnection()
})

describe('a signed-in user over PostgREST', () => {
  it('sees only their own property', async () => {
    const rows = (await selectAs(fx.alpha.user, 'properties', 'select=slug')) as { slug: string }[]

    expect(rows.map((r) => r.slug)).toEqual(['hotel-alpha'])
  })

  it('sees only their own reservations', async () => {
    const rows = (await selectAs(fx.beta.user, 'reservations', 'select=property_id')) as {
      property_id: string
    }[]

    expect(rows).toHaveLength(1)
    expect(rows[0]?.property_id).toBe(fx.beta.propertyId)
  })

  it('gets zero rows when naming another property explicitly', async () => {
    const rows = await selectAs(
      fx.alpha.user,
      'reservations',
      `select=id&property_id=eq.${fx.beta.propertyId}`,
    )

    expect(rows).toEqual([])
  })

  it('gets zero rows when naming another property’s row by id', async () => {
    // The guessable-identifier case. A 404-shaped empty result is the only
    // answer that does not confirm whether the row exists.
    const rows = await selectAs(
      fx.alpha.user,
      'reservations',
      `select=id&id=eq.${fx.beta.reservationId}`,
    )

    expect(rows).toEqual([])
  })

  it('cannot read another person’s profile', async () => {
    const rows = (await selectAs(fx.alpha.user, 'profiles', 'select=user_id')) as {
      user_id: string
    }[]

    expect(rows.map((r) => r.user_id)).toEqual([fx.alpha.user.id])
  })

  it('cannot read guests belonging to another property', async () => {
    const rows = (await selectAs(fx.beta.user, 'guests', 'select=name')) as { name: string }[]

    expect(rows.map((r) => r.name)).toEqual(['hotel-beta guest'])
  })
})

describe('the anonymous key alone', () => {
  it('reads nothing from a tenant table', async () => {
    // No policy grants `anon` anything, and enabling RLS without a policy denies
    // everything. This is the request an attacker makes first.
    const anon = { id: '', email: '', accessToken: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' }
    const rows = await selectAs(anon, 'properties', 'select=slug')

    expect(rows).toEqual([])
  })
})

describe('the reconciliation surface over PostgREST', () => {
  it('shows only the caller’s own discrepancies', async () => {
    const rows = (await selectAs(fx.alpha.user, 'discrepancies', 'select=id')) as { id: string }[]

    expect(rows.map((r) => r.id)).toEqual([fx.alpha.discrepancyId])
  })

  it('shows only the caller’s own reconciliation runs', async () => {
    const rows = (await selectAs(fx.alpha.user, 'reconciliation_runs', 'select=id')) as {
      id: string
    }[]

    expect(rows.map((r) => r.id)).toEqual([fx.alpha.runId])
  })

  it('gets zero rows naming another property’s discrepancy by id', async () => {
    const rows = await selectAs(
      fx.alpha.user,
      'discrepancies',
      `select=id&id=eq.${fx.beta.discrepancyId}`,
    )

    expect(rows).toEqual([])
  })
})
