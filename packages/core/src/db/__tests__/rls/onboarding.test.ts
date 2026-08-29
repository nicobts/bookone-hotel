import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import { withUser } from '../../session'
import { buildChecklist } from '../../../onboarding/checklist'
import {
  grantEntitlement,
  isEntitled,
  listEntitlements,
  revokeEntitlement,
} from '../../../onboarding/entitlements'
import {
  KbRejected,
  listArticles,
  saveArticle,
  saveDrafts,
  setPublished,
} from '../../../onboarding/knowledge'
import { searchKb } from '../../../concierge/kb'

/**
 * Onboarding, the knowledge editor and entitlements (E7.1, E5.3, E7.3).
 *
 * The DoD for this sprint is a non-engineer onboarding a property in ≤5 days,
 * which is not a thing a test can assert. What a test can assert is the two
 * properties that make it possible: the checklist tells the truth about a
 * property's actual state, and an owner editing their own answers changes what
 * the concierge says without anyone deploying anything.
 */

let fixture: Fixture
const actor = { kind: 'system' } as const

beforeAll(async () => {
  fixture = await seed()
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('the checklist', () => {
  it('reads a bare property as not yet bookable, and says which items block it', async () => {
    const checklist = await buildChecklist(fixture.alpha.propertyId)

    expect(checklist).not.toBeNull()
    // The fixture has room types. It has no contact address and the sync engine
    // has not run, so it cannot transact — which is the honest reading, and the
    // list names both.
    expect(checklist!.items.find((item) => item.key === 'rooms')?.done).toBe(true)
    expect(checklist!.canTransact).toBe(false)

    const blocking = checklist!.items
      .filter((item) => item.blocking && !item.done)
      .map((item) => item.key)

    expect(blocking).toContain('contact')
    expect(blocking).toContain('availability')
  })

  it('flips to bookable when the last blocking item is satisfied', async () => {
    /*
     * The assertion that matters: `canTransact` tracks the rows, not a flag.
     *
     * A contact address and one rate snapshot are the two things this fixture
     * is missing, so writing them should be the whole difference — and if a
     * `setup_completed` column ever appears, this is the test that notices it
     * has stopped agreeing with reality.
     */
    await db.execute(sql`
      update properties
      set settings = jsonb_set(
        coalesce(settings, '{}'::jsonb), '{contact}',
        '{"email":"reception@alpha.test"}'::jsonb, true
      )
      where id = ${fixture.alpha.propertyId}
    `)

    await db.execute(sql`
      insert into rate_snapshots
        (property_id, room_type_id, date_from, date_to, price_cents, currency, source)
      select ${fixture.alpha.propertyId}, id, current_date, current_date + 1, 12000, 'EUR', 'mock'
      from room_types where property_id = ${fixture.alpha.propertyId} limit 1
    `)

    const checklist = await buildChecklist(fixture.alpha.propertyId)

    expect(checklist!.canTransact).toBe(true)
  })

  it('is derived, so adding a room type moves it without anything else being told', async () => {
    /*
     * The whole reason there is no `setup_completed` column.
     *
     * This inserts a room type directly — no domain function, no event — and
     * the checklist notices, because it reads the same rows the product does.
     * A stored flag would still say "not done" and send the owner to do a thing
     * they had already done.
     */
    const before = await buildChecklist(fixture.beta.propertyId)
    const rooms = before!.items.find((item) => item.key === 'rooms')!.detail ?? 0

    await db.execute(sql`
      insert into room_types (property_id, code, name_i18n, capacity)
      values (${fixture.beta.propertyId}, 'SUITE', '{"en":"Suite"}'::jsonb, 3)
    `)

    const after = await buildChecklist(fixture.beta.propertyId)

    expect(after!.items.find((item) => item.key === 'rooms')!.detail).toBe(rooms + 1)
  })

  it('marks the payment account as ours to do, and never done', async () => {
    const checklist = await buildChecklist(fixture.alpha.propertyId)
    const payments = checklist!.items.find((item) => item.key === 'payments')!

    // ADR-010: no provider is connected. It is on the list rather than hidden,
    // because an owner who finds out at go-live has been misled by an absence.
    expect(payments.blockedOnUs).toBe(true)
    expect(payments.done).toBe(false)
  })

  it('does not count what only we can do towards the owner progress', async () => {
    const checklist = await buildChecklist(fixture.alpha.propertyId)

    // A progress fraction an owner can never complete is a progress fraction
    // that reads as failure however much they do.
    expect(checklist!.total).toBe(checklist!.items.filter((item) => !item.blockedOnUs).length)
    expect(checklist!.done).toBeLessThanOrEqual(checklist!.total)
  })

  it('returns null for a property that does not exist', async () => {
    expect(await buildChecklist('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

describe('the knowledge editor', () => {
  it('makes an answer live to the concierge immediately', async () => {
    await saveArticle({
      propertyId: fixture.alpha.propertyId,
      topic: 'breakfast',
      questionVariants: ['what time is breakfast'],
      answers: { en: 'Breakfast is served from 07:30 to 10:00.' },
      actor,
    })

    // E5.3 asks for ≤60s. There is no cache, so the next question has it —
    // and this test is what would fail if somebody later added one.
    const found = await searchKb(fixture.alpha.propertyId, 'what time is breakfast?', 'en')

    expect(found?.answer).toContain('07:30')
  })

  it('bumps the version on every edit', async () => {
    const first = await saveArticle({
      propertyId: fixture.alpha.propertyId,
      topic: 'parking',
      questionVariants: ['where can I park'],
      answers: { en: 'Four free spaces behind the building.' },
      actor,
    })

    const second = await saveArticle({
      propertyId: fixture.alpha.propertyId,
      topic: 'parking',
      questionVariants: ['where can I park', 'is there parking'],
      answers: { en: 'Four free spaces behind the building. The gate code is 4417.' },
      actor,
    })

    // "The KB said so" is only a defence if the article can be shown as it
    // stood, and the version is what makes an `agent_runs` record point at
    // something specific.
    expect(second.id).toBe(first.id)
    expect(second.version).toBe(first.version + 1)
  })

  it('drops a blank answer rather than storing an empty language', async () => {
    await saveArticle({
      propertyId: fixture.alpha.propertyId,
      topic: 'wifi',
      questionVariants: ['what is the wifi password'],
      answers: { en: 'The network is Sonja-Guest.', de: '   ', sl: '' },
      actor,
    })

    const [article] = (await listArticles(fixture.alpha.propertyId)).filter(
      (row) => row.topic === 'wifi',
    )

    // `{ de: "" }` would read in the editor as an answer somebody deleted
    // rather than one nobody has written.
    expect(Object.keys(article!.answers)).toEqual(['en'])
  })

  it('refuses an article with no answer in any language', async () => {
    await expect(
      saveArticle({
        propertyId: fixture.alpha.propertyId,
        topic: 'sauna',
        questionVariants: ['is the sauna open'],
        answers: { en: '  ', de: '' },
        actor,
      }),
    ).rejects.toBeInstanceOf(KbRejected)
  })

  it('takes an answer out of service without deleting what it said', async () => {
    const [article] = (await listArticles(fixture.alpha.propertyId)).filter(
      (row) => row.topic === 'wifi',
    )

    await setPublished({
      propertyId: fixture.alpha.propertyId,
      articleId: article!.id,
      published: false,
      actor,
    })

    // Invisible to guests, still on the owner's screen. The row survives
    // because it is evidence of what a guest was told.
    expect(await searchKb(fixture.alpha.propertyId, 'what is the wifi password', 'en')).toBeNull()
    expect((await listArticles(fixture.alpha.propertyId)).some((row) => row.topic === 'wifi')).toBe(
      true,
    )
  })
})

describe('AG-03 drafts', () => {
  it('writes them unpublished, so no guest can be told them', async () => {
    await saveDrafts({
      propertyId: fixture.beta.propertyId,
      drafts: [
        {
          topic: 'pool',
          questionVariants: ['the pool'],
          answers: { en: 'Our heated pool is open from 08:00 to 20:00 for all guests.' },
          source: { heading: 'The pool', url: 'https://example.test/' },
        },
      ],
      actor,
    })

    /*
     * The structural guarantee, asserted rather than assumed.
     *
     * A heuristic wrote this sentence. It is on the owner's screen and the
     * concierge refuses to quote it — which is why a heuristic is allowed near
     * guest-facing copy at all (binding rule 7).
     */
    expect(await searchKb(fixture.beta.propertyId, 'is the pool open', 'en')).toBeNull()

    const [draft] = (await listArticles(fixture.beta.propertyId)).filter(
      (row) => row.topic === 'pool',
    )
    expect(draft?.published).toBe(false)
  })

  it('does not overwrite an answer the owner has already written', async () => {
    const before = await saveArticle({
      propertyId: fixture.beta.propertyId,
      topic: 'breakfast',
      questionVariants: ['a che ora è la colazione'],
      answers: { it: 'La colazione è servita dalle 08:00 alle 10:00.' },
      actor,
    })

    const result = await saveDrafts({
      propertyId: fixture.beta.propertyId,
      drafts: [
        {
          topic: 'breakfast',
          questionVariants: ['breakfast'],
          answers: { en: 'Scraped from the website and probably out of date.' },
          source: { heading: 'Breakfast', url: 'https://example.test/' },
        },
      ],
      actor,
    })

    expect(result.skipped).toBe(1)

    const [article] = (await listArticles(fixture.beta.propertyId)).filter(
      (row) => row.topic === 'breakfast',
    )

    // Same version, same words. An owner finding their own answer replaced by
    // one scraped off their website would stop trusting the editor.
    expect(article!.version).toBe(before.version)
    expect(article!.answers.it).toContain('08:00')
  })

  it('sorts drafts above published articles, so the editor is the review surface', async () => {
    const articles = await listArticles(fixture.beta.propertyId)
    const firstPublished = articles.findIndex((row) => row.published)
    const lastDraft = articles.map((row) => row.published).lastIndexOf(false)

    expect(lastDraft).toBeLessThan(firstPublished)
  })
})

describe('entitlements', () => {
  it('is off until a row says otherwise', async () => {
    // Absence is the answer, and the answer is no. A bug in this plumbing fails
    // closed — a property loses a module they paid for and tells us within the
    // hour, rather than silently gaining one nobody reports.
    expect(await isEntitled(fixture.alpha.propertyId, 'concierge')).toBe(false)
  })

  it('grants once, however many times it is asked', async () => {
    const first = await grantEntitlement({
      propertyId: fixture.alpha.propertyId,
      feature: 'concierge',
    })
    const second = await grantEntitlement({
      propertyId: fixture.alpha.propertyId,
      feature: 'concierge',
    })

    expect(first.status).toBe('granted')
    expect(second.status).toBe('already-granted')
    expect(await listEntitlements(fixture.alpha.propertyId)).toEqual(['concierge'])
  })

  it('revokes by ending the row, never by deleting it', async () => {
    await revokeEntitlement({ propertyId: fixture.alpha.propertyId, feature: 'concierge' })

    expect(await isEntitled(fixture.alpha.propertyId, 'concierge')).toBe(false)

    const [row] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from entitlements
          where property_id = ${fixture.alpha.propertyId} and feature = 'concierge'`,
    )

    // "Never had it" and "had it until March" are different answers to the
    // question a billing dispute actually asks.
    expect(row!.count).toBe(1)
  })

  it('can be sold again after being revoked', async () => {
    // The partial unique index is on live rows only. A plain unique would make
    // re-selling a module impossible.
    const again = await grantEntitlement({
      propertyId: fixture.alpha.propertyId,
      feature: 'concierge',
    })

    expect(again.status).toBe('granted')
    expect(await isEntitled(fixture.alpha.propertyId, 'concierge')).toBe(true)
  })
})

describe('isolation', () => {
  it('shows a member their own entitlements', async () => {
    const rows = (await selectAs(fixture.alpha.user, 'entitlements')) as {
      property_id: string
    }[]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.property_id === fixture.alpha.propertyId)).toBe(true)
  })

  it('shows the other property none of them', async () => {
    expect(await selectAs(fixture.beta.user, 'entitlements')).toEqual([])
  })

  it('refuses a property granting itself a paid module', async () => {
    /*
     * A module is a contract term (D14 row 4). An insert policy here would let
     * a property enable something it has not bought — and the same table is
     * what the module line on its statement is built from.
     */
    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`
          insert into entitlements (property_id, feature)
          values (${fixture.alpha.propertyId}, 'rooms')
        `),
      ),
    )
  })

  it('does not let one property read another knowledge base through the editor', async () => {
    await saveArticle({
      propertyId: fixture.alpha.propertyId,
      topic: 'checkout',
      questionVariants: ['what time is checkout'],
      answers: { en: 'Checkout is by 11:00.' },
      actor,
    })

    const beta = await listArticles(fixture.beta.propertyId)

    expect(beta.every((row) => row.topic !== 'checkout')).toBe(true)
  })
})
