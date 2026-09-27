import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import { complaints, reservations, guests } from '../db/schema'
import { emit } from '../events'
import { formatActor, type Actor } from '../events/actor'
import { MessageRejected } from './thread'

/**
 * Complaints (Guest Desk WP0.3).
 *
 * Logged by the `complaints` profile's `log_complaint` tool, or by staff.
 * Every complaint goes to a person (T2); the owner is told when it is logged.
 * Each write emits its domain event in the same transaction (binding rule 2).
 */
export const COMPLAINT_CATEGORIES = [
  'room',
  'noise',
  'cleanliness',
  'staff',
  'billing',
  'safety',
  'other',
] as const

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number]

/** 5 minutes for safety, 30 otherwise — the complaints profile's escalation rules. */
export function slaMinutesFor(category: ComplaintCategory): number {
  return category === 'safety' ? 5 : 30
}

export function isComplaintCategory(value: unknown): value is ComplaintCategory {
  return typeof value === 'string' && (COMPLAINT_CATEGORIES as readonly string[]).includes(value)
}

export async function logComplaint(input: {
  propertyId: string
  reservationId: string
  threadId?: string | null
  category: ComplaintCategory
  summary: string
  actor: Actor
}): Promise<{ id: string; slaMinutes: number; slaDueAt: Date }> {
  const summary = input.summary.trim().slice(0, 500)
  if (!summary) throw new MessageRejected('a complaint needs a summary')

  const slaMinutes = slaMinutesFor(input.category)

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(complaints)
        .values({
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          threadId: input.threadId ?? null,
          category: input.category,
          summary,
          slaMinutes,
          // One clock: the deadline and `created_at` both come from the
          // database, so they cannot disagree about when this was logged.
          slaDueAt: sql`now() + make_interval(mins => ${slaMinutes})`,
          createdBy: formatActor(input.actor),
        })
        .returning({ id: complaints.id, slaDueAt: complaints.slaDueAt })

      if (!row) throw new MessageRejected('complaint insert returned no row')

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'complaint',
        entityId: row.id,
        eventType: 'complaint.logged',
        origin: 'platform',
        actor: input.actor,
        payload: { reservationId: input.reservationId, category: input.category, slaMinutes },
      })

      return { id: row.id, slaMinutes, slaDueAt: row.slaDueAt }
    }),
  )
}

/** Stamped once the owner has been told, so they are told once. */
export async function markComplaintOwnerAlerted(
  propertyId: string,
  complaintId: string,
): Promise<void> {
  await asService((db) =>
    db
      .update(complaints)
      .set({ ownerAlertedAt: sql`now()` })
      .where(
        and(
          eq(complaints.propertyId, propertyId),
          eq(complaints.id, complaintId),
          isNull(complaints.ownerAlertedAt),
        ),
      ),
  )
}

export interface OpenComplaint {
  id: string
  reservationId: string
  guestName: string | null
  category: ComplaintCategory
  summary: string
  status: 'open' | 'acknowledged'
  slaDueAt: Date
  createdAt: Date
}

/** Complaints not yet resolved at one property, the most urgent deadline first. */
export async function listOpenComplaints(propertyId: string, limit = 50): Promise<OpenComplaint[]> {
  const rows = await asService((db) =>
    db
      .select({
        id: complaints.id,
        reservationId: complaints.reservationId,
        guestName: guests.name,
        category: complaints.category,
        summary: complaints.summary,
        status: complaints.status,
        slaDueAt: complaints.slaDueAt,
        createdAt: complaints.createdAt,
      })
      .from(complaints)
      .innerJoin(reservations, eq(reservations.id, complaints.reservationId))
      .leftJoin(guests, eq(guests.id, reservations.guestId))
      .where(
        and(
          eq(complaints.propertyId, propertyId),
          inArray(complaints.status, ['open', 'acknowledged']),
        ),
      )
      .orderBy(asc(complaints.slaDueAt))
      .limit(limit),
  )

  return rows.map((row) => ({ ...row, status: row.status as 'open' | 'acknowledged' }))
}
