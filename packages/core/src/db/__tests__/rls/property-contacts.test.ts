import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { asService } from '../../session'
import { createUser, seed, selectAs, type Fixture, type TestUser } from './support'
import {
  addContact,
  confirmContactInformed,
  contactPhones,
  isOwnerContact,
  listContacts,
  removeContact,
} from '../../../contacts'
import { routeInboundMessage } from '../../../channels/inbound'
import { AdminRefused, adminSetFeature } from '../../../admin'

/**
 * The people a property pages (`property_contacts`): owner-only, on both access
 * paths, and never across properties (privacy runbook, "Owner and staff contact
 * numbers").
 */

let fixture: Fixture
/** A member of alpha who is not an owner: a receptionist. */
let receptionist: TestUser

const ALPHA_OWNER = '+393330000101'
const ALPHA_STAFF = '+393330000102'
const BETA_OWNER = '+393330000201'

beforeAll(async () => {
  fixture = await seed()
  receptionist = await createUser(`reception-${Date.now()}@bookone.test`)
  await db.execute(sql`
    insert into property_members (property_id, user_id, role)
    values (${fixture.alpha.propertyId}, ${receptionist.id}, 'staff')`)

  for (const [property, role, phone] of [
    [fixture.alpha, 'owner', ALPHA_OWNER],
    [fixture.alpha, 'staff', ALPHA_STAFF],
    [fixture.beta, 'owner', BETA_OWNER],
  ] as const) {
    const result = await addContact(property.user.id, property.propertyId, {
      role,
      name: `${role} contact`,
      phone,
      informed: true,
    })
    expect(result.status).toBe('added')
  }
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('who may read them', () => {
  it('shows an owner their own property’s contacts, in full', async () => {
    const contacts = await listContacts(fixture.alpha.user.id, fixture.alpha.propertyId)
    expect(contacts.map((contact) => contact.phone).sort()).toEqual([ALPHA_OWNER, ALPHA_STAFF])
    expect(contacts.every((contact) => contact.informedAt instanceof Date)).toBe(true)
  })

  it('shows a receptionist of the same property nothing, on both paths', async () => {
    // The reason the numbers left `properties.settings`: any member read those.
    expect(await listContacts(receptionist.id, fixture.alpha.propertyId)).toEqual([])
    expect(await selectAs(receptionist, 'property_contacts')).toEqual([])
    const [settings] = (await selectAs(
      receptionist,
      'properties',
      `select=settings&id=eq.${fixture.alpha.propertyId}`,
    )) as { settings: Record<string, unknown> }[]
    expect(JSON.stringify(settings)).not.toContain(ALPHA_OWNER)
  })

  it('shows another property’s owner none of them, on both paths', async () => {
    expect(await listContacts(fixture.beta.user.id, fixture.alpha.propertyId)).toEqual([])
    const rows = (await selectAs(fixture.beta.user, 'property_contacts')) as { phone: string }[]
    expect(rows.map((row) => row.phone)).toEqual([BETA_OWNER])
  })
})

describe('who may change them', () => {
  it('refuses a receptionist’s insert, and a stranger’s delete', async () => {
    expect(
      await addContact(receptionist.id, fixture.alpha.propertyId, {
        role: 'staff',
        name: 'Me',
        phone: '+393330000199',
        informed: true,
      }),
    ).toEqual({ status: 'forbidden' })

    const [alphaContact] = await listContacts(fixture.alpha.user.id, fixture.alpha.propertyId)
    expect(
      await removeContact(fixture.beta.user.id, fixture.alpha.propertyId, alphaContact!.id),
    ).toBe(false)
    expect(await removeContact(receptionist.id, fixture.alpha.propertyId, alphaContact!.id)).toBe(
      false,
    )
    expect(await listContacts(fixture.alpha.user.id, fixture.alpha.propertyId)).toHaveLength(2)
  })

  it('requires a country code, a name, and the owner’s word that the person was told', async () => {
    const base = { role: 'staff', name: 'Marta', phone: '+39 333 000 0150', informed: true }
    const add = (over: Partial<typeof base>) =>
      addContact(fixture.alpha.user.id, fixture.alpha.propertyId, { ...base, ...over })

    expect(await add({ phone: '333 000 0150' })).toEqual({ status: 'invalid-phone' })
    expect(await add({ name: '  ' })).toEqual({ status: 'invalid-name' })
    expect(await add({ informed: false })).toEqual({ status: 'not-informed' })
    expect(await add({ role: 'manager' })).toEqual({ status: 'invalid-role' })
    expect(await add({ phone: ALPHA_STAFF })).toEqual({ status: 'duplicate' })
  })

  it('records each change as an event with the role, never the number or the name', async () => {
    const added = await addContact(fixture.alpha.user.id, fixture.alpha.propertyId, {
      role: 'staff',
      name: 'Night porter',
      phone: '0039 333 000 0160',
      informed: true,
    })
    expect(added.status).toBe('added')
    const id = (added as { id: string }).id
    expect(await removeContact(fixture.alpha.user.id, fixture.alpha.propertyId, id)).toBe(true)

    const events = await db.execute<{ event_type: string; payload: unknown; actor: string }>(sql`
      select event_type, payload, actor from domain_events
       where entity_type = 'property_contact' and entity_id = ${id} order by id`)
    expect(events.map((event) => event.event_type)).toEqual([
      'property_contact.added',
      'property_contact.removed',
    ])
    for (const event of events) {
      expect(event.payload).toEqual({ role: 'staff' })
      expect(event.actor).toBe(`user:${fixture.alpha.user.id}`)
    }
  })

  it('lets an owner confirm, once, that a carried-over contact was told', async () => {
    const [row] = await db.execute<{ id: string }>(sql`
      insert into property_contacts (property_id, role, name, phone)
      values (${fixture.alpha.propertyId}, 'staff', 'Staff', '+393330000170') returning id`)

    expect(await confirmContactInformed(receptionist.id, fixture.alpha.propertyId, row!.id)).toBe(
      false,
    )
    expect(
      await confirmContactInformed(fixture.alpha.user.id, fixture.alpha.propertyId, row!.id),
    ).toBe(true)
    expect(
      await confirmContactInformed(fixture.alpha.user.id, fixture.alpha.propertyId, row!.id),
    ).toBe(false)
  })
})

describe('who is paged', () => {
  it('pages each property only from its own list', async () => {
    const alphaOwners = await asService((tx) =>
      contactPhones(tx, fixture.alpha.propertyId, 'owner'),
    )
    expect(alphaOwners).toEqual([ALPHA_OWNER])
    expect(await isOwnerContact(fixture.alpha.propertyId, '+39 333 000 0101')).toBe(true)
    // Beta's owner is nobody at alpha.
    expect(await isOwnerContact(fixture.alpha.propertyId, BETA_OWNER)).toBe(false)
    // A staff number never reaches the owner agent.
    expect(await isOwnerContact(fixture.alpha.propertyId, ALPHA_STAFF)).toBe(false)
  })
})

describe('one sender number, one property', () => {
  const SHARED = '+39 040 999 0077'

  it('routes nothing when two properties record the number written to', async () => {
    for (const property of [fixture.alpha, fixture.beta]) {
      await db.execute(sql`
        update properties set settings = settings || ${JSON.stringify({ whatsappNumber: SHARED })}::jsonb
         where id = ${property.propertyId}`)
    }

    expect(
      await routeInboundMessage({
        channel: 'whatsapp',
        provider: 'twilio',
        providerMessageId: `SM${'7'.repeat(32)}`,
        from: ALPHA_OWNER,
        to: SHARED,
        body: 'Quanti arrivi domani?',
      }),
    ).toEqual({ kind: 'ambiguous-number' })
  })

  it('refuses to switch WhatsApp on for a property whose number another records', async () => {
    const staff = { id: 'op-1', email: 'op@bookone.test', role: 'admin' as const }
    await expect(
      adminSetFeature(staff, {
        propertyId: fixture.beta.propertyId,
        feature: 'whatsapp',
        enabled: true,
        reason: 'test the guard',
      }),
    ).rejects.toBeInstanceOf(AdminRefused)

    const [granted] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from entitlements
       where property_id = ${fixture.beta.propertyId} and feature = 'whatsapp'`)
    expect(granted!.n).toBe(0)

    // With the number corrected, the same request goes through.
    await db.execute(sql`
      update properties set settings = settings || '{"whatsappNumber": "+39 040 999 0078"}'::jsonb
       where id = ${fixture.beta.propertyId}`)
    await expect(
      adminSetFeature(staff, {
        propertyId: fixture.beta.propertyId,
        feature: 'whatsapp',
        enabled: true,
        reason: 'test the guard',
      }),
    ).resolves.toEqual({ changed: true })
  })
})
