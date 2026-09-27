import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { asService } from '../db/session'
import { domainEvents, registrationRecords, reservations } from '../db/schema'
import { emit } from '../events'
import { guestActor, userActor } from '../events/actor'
import { registrationToGuestDetails } from '../alloggiati/submit'
import { schedinaPreview, type SchedinaPreview } from '../alloggiati/schedina'
import { applyJourneyCommandIn } from './apply'

/**
 * Pre-arrival capture ends here in Guest Desk Phase 0 (WP0.4): a person looks at
 * the schedina preview and the documents, and confirms. Nothing is filed.
 *
 * Confirming is a person's statement that the record matches the documents they
 * saw. It is **not** an identity verification and BookOne does not make one
 * (ADR-027): the staff member confirms, and the record says who did.
 */

/** The party's schedina preview for one stay, from its registration records. */
export async function getSchedinaPreview(
  propertyId: string,
  reservationId: string,
): Promise<(SchedinaPreview & { documentsHeld: number; confirmedAt: Date | null }) | null> {
  const [stay] = await asService((db) =>
    db
      .select({ arrivalDate: reservations.arrivalDate, departureDate: reservations.departureDate })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1),
  )
  if (!stay) return null

  const records = await asService((db) =>
    db
      .select({
        data: registrationRecords.data,
        documentPath: registrationRecords.documentPath,
        validatedAt: registrationRecords.validatedAt,
      })
      .from(registrationRecords)
      .where(
        and(
          eq(registrationRecords.reservationId, reservationId),
          eq(registrationRecords.propertyId, propertyId),
          isNull(registrationRecords.deletedAt),
        ),
      )
      .orderBy(asc(registrationRecords.guestIndex)),
  )

  const preview = schedinaPreview(
    records.map((record) => registrationToGuestDetails(record.data)),
    { arrivalDate: stay.arrivalDate, departureDate: stay.departureDate },
  )

  const confirmed = records
    .map((record) => record.validatedAt)
    .filter((at): at is Date => at !== null)

  return {
    ...preview,
    documentsHeld: records.filter((record) => record.documentPath !== null).length,
    confirmedAt: confirmed.length === records.length && confirmed.length > 0 ? confirmed[0]! : null,
  }
}

export type ConfirmOutcome = { status: 'confirmed' } | { status: 'rejected'; reason: string }

/**
 * A staff member confirms the party's documents (WP0.4 "Conferma").
 *
 * Refused unless the preview is ready — every required field present — and a
 * document is held for every guest: confirming an incomplete record would be a
 * person vouching for a gap. One transaction: the journey command, which emits
 * its event, and the per-guest `validated_at` stamp, from the database clock.
 */
export async function confirmDocuments(input: {
  propertyId: string
  reservationId: string
  userId: string
}): Promise<ConfirmOutcome> {
  const preview = await getSchedinaPreview(input.propertyId, input.reservationId)
  if (!preview) return { status: 'rejected', reason: 'unknown reservation' }
  if (!preview.ready) return { status: 'rejected', reason: 'the record is incomplete' }
  if (preview.documentsHeld < preview.guests.length) {
    return { status: 'rejected', reason: 'a document is missing for at least one guest' }
  }

  return asService((db) =>
    db.transaction(async (tx) => {
      const applied = await applyJourneyCommandIn(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        command: { type: 'documents.validate' },
        actor: userActor(input.userId),
      })

      if (applied.status === 'refused')
        return { status: 'rejected' as const, reason: applied.reason }

      await tx
        .update(registrationRecords)
        .set({ validatedAt: new Date() })
        .where(
          and(
            eq(registrationRecords.reservationId, input.reservationId),
            eq(registrationRecords.propertyId, input.propertyId),
            isNotNull(registrationRecords.documentPath),
            isNull(registrationRecords.validatedAt),
          ),
        )

      return { status: 'confirmed' as const }
    }),
  )
}

const CONSENT_EVENT = 'privacy.document_consent'

/**
 * Whether the guest has consented to the property processing their identity
 * documents for registration (WP0.4). Recorded as a domain event: it carries its
 * timestamp and actor by construction, and it is erased with the rest of the
 * stay's events when the guest asks.
 */
export async function hasDocumentConsent(
  propertyId: string,
  reservationId: string,
): Promise<boolean> {
  const [row] = await asService((db) =>
    db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.propertyId, propertyId),
          eq(domainEvents.entityId, reservationId),
          eq(domainEvents.eventType, CONSENT_EVENT),
        ),
      )
      .limit(1),
  )
  return Boolean(row)
}

/** Record the guest's consent, once. */
export async function recordDocumentConsent(input: {
  propertyId: string
  reservationId: string
  noticeVersion: string
}): Promise<void> {
  if (await hasDocumentConsent(input.propertyId, input.reservationId)) return

  await asService((db) =>
    db.transaction((tx) =>
      emit(tx, {
        propertyId: input.propertyId,
        entityType: 'reservation',
        entityId: input.reservationId,
        eventType: CONSENT_EVENT,
        origin: 'platform',
        actor: guestActor(input.reservationId),
        payload: { noticeVersion: input.noticeVersion },
      }),
    ),
  )
}
