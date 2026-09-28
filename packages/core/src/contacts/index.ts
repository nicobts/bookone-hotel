import { and, asc, eq, isNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { propertyContacts } from '../db/schema'
import type * as schema from '../db/schema'
import { asService, withUser } from '../db/session'
import { emit } from '../events/emitter'
import { userActor } from '../events/actor'

/**
 * The people a property pages by phone (`property_contacts`).
 *
 * Two readers, two paths. The console reads and changes them as the signed-in
 * user, so RLS decides and only an owner gets anything (ADR-018). Paging and
 * recognising the owner on WhatsApp read them under the service role, always
 * for one property named by the caller (ADR-007).
 *
 * No event, log line or span carries a number or a name: events record the
 * contact's id and role, which is what an audit needs.
 */

export type ContactRole = 'owner' | 'staff'

export const CONTACT_ROLES: readonly ContactRole[] = ['owner', 'staff']

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select'>

/**
 * A number as E.164, or null.
 *
 * `+` and digits, or `00` and digits; spaces, dots and dashes are ignored.
 * A number without a country code is refused rather than guessed at: a page
 * sent to the wrong country's version of a local number reaches a stranger.
 */
export function toE164(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  const e164 = trimmed.startsWith('+')
    ? `+${digits}`
    : digits.startsWith('00')
      ? `+${digits.slice(2)}`
      : null
  return e164 && /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null
}

/** The numbers to page for one role at one property. Service path. */
export async function contactPhones(
  db: Db,
  propertyId: string,
  role: ContactRole,
): Promise<string[]> {
  const rows = await db
    .select({ phone: propertyContacts.phone })
    .from(propertyContacts)
    .where(and(eq(propertyContacts.propertyId, propertyId), eq(propertyContacts.role, role)))
    .orderBy(asc(propertyContacts.createdAt))
  return [...new Set(rows.map((row) => row.phone))]
}

/** Whether a sender is one of the property's recorded owner numbers. */
export async function isOwnerContact(propertyId: string, phone: string): Promise<boolean> {
  const e164 = toE164(phone)
  if (!e164) return false
  const phones = await asService((db) => contactPhones(db, propertyId, 'owner'))
  return phones.includes(e164)
}

export interface Contact {
  id: string
  role: ContactRole
  name: string
  phone: string
  informedAt: Date | null
  createdAt: Date
}

/** The contacts an owner manages. Empty for anyone who is not an owner (RLS). */
export async function listContacts(userId: string, propertyId: string): Promise<Contact[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: propertyContacts.id,
        role: propertyContacts.role,
        name: propertyContacts.name,
        phone: propertyContacts.phone,
        informedAt: propertyContacts.informedAt,
        createdAt: propertyContacts.createdAt,
      })
      .from(propertyContacts)
      .where(eq(propertyContacts.propertyId, propertyId))
      .orderBy(asc(propertyContacts.role), asc(propertyContacts.createdAt)),
  )
  return rows.map((row) => ({ ...row, role: row.role as ContactRole }))
}

export type AddContactResult =
  | { status: 'added'; id: string }
  | { status: 'invalid-phone' }
  | { status: 'invalid-name' }
  | { status: 'invalid-role' }
  /** The owner did not confirm the person was told (Art. 13). */
  | { status: 'not-informed' }
  | { status: 'duplicate' }
  /** RLS refused it: the user is not an owner of this property. */
  | { status: 'forbidden' }

export async function addContact(
  userId: string,
  propertyId: string,
  input: { role: string; name: string; phone: string; informed: boolean },
): Promise<AddContactResult> {
  if (!CONTACT_ROLES.includes(input.role as ContactRole)) return { status: 'invalid-role' }
  const name = input.name.trim()
  if (name.length < 1 || name.length > 80) return { status: 'invalid-name' }
  const phone = toE164(input.phone)
  if (!phone) return { status: 'invalid-phone' }
  if (!input.informed) return { status: 'not-informed' }

  try {
    return await withUser(userId, async (tx) => {
      const [row] = await tx
        .insert(propertyContacts)
        .values({ propertyId, role: input.role, name, phone, informedAt: new Date() })
        .onConflictDoNothing()
        .returning({ id: propertyContacts.id })
      if (!row) return { status: 'duplicate' as const }

      await emit(tx, {
        propertyId,
        entityType: 'property_contact',
        entityId: row.id,
        eventType: 'property_contact.added',
        origin: 'platform',
        actor: userActor(userId),
        payload: { role: input.role },
      })
      return { status: 'added' as const, id: row.id }
    })
  } catch (error) {
    // RLS refuses the insert for a non-owner with 42501; nothing else is
    // expected here, so anything else is rethrown.
    if (isRlsRefusal(error)) return { status: 'forbidden' }
    throw error
  }
}

/** Removes a contact. False when there was nothing this user may remove. */
export async function removeContact(
  userId: string,
  propertyId: string,
  contactId: string,
): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .delete(propertyContacts)
      .where(and(eq(propertyContacts.id, contactId), eq(propertyContacts.propertyId, propertyId)))
      .returning({ id: propertyContacts.id, role: propertyContacts.role })
    if (!row) return false

    await emit(tx, {
      propertyId,
      entityType: 'property_contact',
      entityId: row.id,
      eventType: 'property_contact.removed',
      origin: 'platform',
      actor: userActor(userId),
      payload: { role: row.role },
    })
    return true
  })
}

/**
 * The owner confirms a carried-over contact was told (Art. 13). Only for a
 * contact with no confirmation yet; a confirmation is never moved.
 */
export async function confirmContactInformed(
  userId: string,
  propertyId: string,
  contactId: string,
): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .update(propertyContacts)
      .set({ informedAt: new Date() })
      .where(
        and(
          eq(propertyContacts.id, contactId),
          eq(propertyContacts.propertyId, propertyId),
          isNull(propertyContacts.informedAt),
        ),
      )
      .returning({ id: propertyContacts.id, role: propertyContacts.role })
    if (!row) return false

    await emit(tx, {
      propertyId,
      entityType: 'property_contact',
      entityId: row.id,
      eventType: 'property_contact.informed',
      origin: 'platform',
      actor: userActor(userId),
      payload: { role: row.role },
    })
    return true
  })
}

function isRlsRefusal(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if ((current as { code?: unknown }).code === '42501') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
