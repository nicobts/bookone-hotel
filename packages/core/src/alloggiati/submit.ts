import { createHash } from 'node:crypto'
import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { asService } from '../db/session'
import {
  alloggiatiSubmissions,
  externalRefs,
  journeyStates,
  registrationRecords,
  reservations,
} from '../db/schema'
import { emit } from '../events'
import { systemActor, userActor, type Actor } from '../events/actor'
import { applyJourneyCommandIn } from '../journey/apply'
import { AlloggiatiError, type AlloggiatiAdapter } from './adapter'
import { buildPayload, validateParty, type GuestDetails, type ValidationIssue } from './record'

/**
 * Staging, filing and acknowledging (E2.3), and the deletion that follows (E2.4).
 *
 * The obligation belongs to the property: Italian law requires an
 * accommodation provider to report every guest to the Questura within 24 hours
 * of arrival. We prepare and carry the filing; they remain the declarant. The
 * contract mirror in `docs/contracts/` says so in the words counsel approves,
 * and nothing in this file should ever read as us assuming the duty.
 *
 * MEMO: no channel is connected. `MockAlloggiatiAdapter` files nothing (04 §0
 * item 5 is still open). Everything here is the shipping path.
 */

export type StageOutcome =
  | { status: 'staged'; submissionId: string; guestCount: number }
  | { status: 'already-staged'; submissionId: string }
  /** The party is incomplete. Every problem, not the first (see `validateParty`). */
  | { status: 'incomplete'; issues: ValidationIssue[] }
  | { status: 'rejected'; reason: string }

/**
 * Builds the payload and records it, ready to file.
 *
 * Staging is separate from submitting because the two fail for different
 * reasons and want different answers: a payload that cannot be built is a
 * missing passport number the owner has to chase, and a submission that fails
 * is a channel problem that retries. Collapsing them would put "ask the guest
 * for their date of birth" and "the Questura is down" in the same bucket.
 */
export async function stageAlloggiati(input: {
  propertyId: string
  reservationId: string
  channel: string
  actor?: Actor
}): Promise<StageOutcome> {
  const { propertyId, reservationId, channel } = input

  const loaded = await asService(async (db) => {
    const [reservation] = await db
      .select({
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        status: reservations.status,
      })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)))
      .limit(1)

    if (!reservation) return null

    const records = await db
      .select({ guestIndex: registrationRecords.guestIndex, data: registrationRecords.data })
      .from(registrationRecords)
      .where(
        and(
          eq(registrationRecords.reservationId, reservationId),
          eq(registrationRecords.propertyId, propertyId),
        ),
      )
      .orderBy(asc(registrationRecords.guestIndex))

    const [existing] = await db
      .select({ id: alloggiatiSubmissions.id, status: alloggiatiSubmissions.status })
      .from(alloggiatiSubmissions)
      .where(
        and(
          eq(alloggiatiSubmissions.reservationId, reservationId),
          eq(alloggiatiSubmissions.channel, channel),
        ),
      )
      .limit(1)

    return { reservation, records, existing: existing ?? null }
  })

  if (!loaded) return { status: 'rejected', reason: 'unknown reservation' }
  if (loaded.reservation.status !== 'confirmed') {
    return { status: 'rejected', reason: `reservation is ${loaded.reservation.status}` }
  }

  if (loaded.existing) {
    // Already filed or filing. Re-staging would produce a second declaration
    // for the same guests, which is the property's problem and not a retry.
    return { status: 'already-staged', submissionId: loaded.existing.id }
  }

  const party = loaded.records.map((record) => registrationToGuestDetails(record.data))
  const stay = {
    arrivalDate: loaded.reservation.arrivalDate,
    departureDate: loaded.reservation.departureDate,
  }

  const issues = validateParty(party, stay)
  if (issues.length > 0) return { status: 'incomplete', issues }

  const payload = buildPayload(party as GuestDetails[], stay)
  const checksum = createHash('sha256').update(payload).digest('hex')

  return asService((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(alloggiatiSubmissions)
        .values({
          propertyId,
          reservationId,
          status: 'staged',
          guestCount: party.length,
          payload,
          payloadChecksum: checksum,
          channel,
        })
        .returning({ id: alloggiatiSubmissions.id })

      if (!row) throw new Error('alloggiati_submissions insert returned no row')

      await applyJourneyCommandIn(tx, {
        propertyId,
        reservationId,
        command: { type: 'alloggiati.stage' },
        actor: input.actor ?? systemActor,
      })

      await emit(tx, {
        propertyId,
        entityType: 'alloggiati_submission',
        entityId: row.id,
        eventType: 'alloggiati.staged',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        // The checksum, never the payload. The event log is read far more
        // widely than `alloggiati_submissions`, and the payload is a list of
        // passport numbers.
        payload: { reservationId, guestCount: party.length, checksum, channel },
      })

      return { status: 'staged' as const, submissionId: row.id, guestCount: party.length }
    }),
  )
}

export type SubmitOutcome =
  | { status: 'acknowledged'; submissionId: string }
  /** Filed, awaiting the authority. The sweep picks it up. */
  | { status: 'submitted'; submissionId: string }
  | { status: 'already-done'; submissionId: string }
  | { status: 'failed'; submissionId: string; reason: string; retryable: boolean }
  | { status: 'nothing-staged' }

/**
 * Files a staged submission.
 *
 * Idempotent against the channel by construction: one submission row per
 * reservation per channel, and this refuses to re-file one that is already
 * submitted or acknowledged. A duplicate schedina is a compliance problem for
 * the property, and the authority has no interest in our retry policy.
 */
export async function submitAlloggiati(
  deps: { adapter: AlloggiatiAdapter },
  input: { propertyId: string; reservationId: string; actor?: Actor },
): Promise<SubmitOutcome> {
  const { adapter } = deps
  const { propertyId, reservationId } = input

  const staged = await asService(async (db) => {
    const [row] = await db
      .select({
        id: alloggiatiSubmissions.id,
        status: alloggiatiSubmissions.status,
        payload: alloggiatiSubmissions.payload,
        guestCount: alloggiatiSubmissions.guestCount,
        attempts: alloggiatiSubmissions.attempts,
      })
      .from(alloggiatiSubmissions)
      .where(
        and(
          eq(alloggiatiSubmissions.reservationId, reservationId),
          eq(alloggiatiSubmissions.propertyId, propertyId),
          eq(alloggiatiSubmissions.channel, adapter.channel),
        ),
      )
      .limit(1)

    return row ?? null
  })

  if (!staged) return { status: 'nothing-staged' }

  if (staged.status === 'submitted' || staged.status === 'acknowledged') {
    return { status: 'already-done', submissionId: staged.id }
  }

  let result
  try {
    result = await adapter.submit({
      propertyId,
      reservationId,
      payload: staged.payload,
      guestCount: staged.guestCount,
    })
  } catch (cause) {
    const error =
      cause instanceof AlloggiatiError
        ? cause
        : new AlloggiatiError('unavailable', String(cause), true)

    await asService((db) =>
      db.transaction(async (tx) => {
        await tx
          .update(alloggiatiSubmissions)
          .set({
            status: 'failed',
            lastError: error.message,
            attempts: staged.attempts + 1,
          })
          .where(eq(alloggiatiSubmissions.id, staged.id))

        await applyJourneyCommandIn(tx, {
          propertyId,
          reservationId,
          command: { type: 'alloggiati.fail' },
          actor: input.actor ?? systemActor,
        })

        await emit(tx, {
          propertyId,
          entityType: 'alloggiati_submission',
          entityId: staged.id,
          eventType: 'alloggiati.failed',
          origin: 'platform',
          actor: input.actor ?? systemActor,
          payload: { reservationId, error: error.message, retryable: error.retryable },
        })
      }),
    )

    return {
      status: 'failed',
      submissionId: staged.id,
      reason: error.message,
      retryable: error.retryable,
    }
  }

  await asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(alloggiatiSubmissions)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          attempts: staged.attempts + 1,
          lastError: null,
        })
        .where(eq(alloggiatiSubmissions.id, staged.id))

      // The channel's reference lives in `external_refs`, like every foreign id
      // (ADR-001) — which also means changing channel later leaves no column
      // named after the one we left.
      await tx
        .insert(externalRefs)
        .values({
          propertyId,
          entityType: 'alloggiati_submission',
          entityId: staged.id,
          system: adapter.channel,
          externalId: result.reference,
        })
        .onConflictDoNothing()

      await applyJourneyCommandIn(tx, {
        propertyId,
        reservationId,
        command: { type: 'alloggiati.submit' },
        actor: input.actor ?? systemActor,
      })

      await emit(tx, {
        propertyId,
        entityType: 'alloggiati_submission',
        entityId: staged.id,
        eventType: 'alloggiati.submitted',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: { reservationId, reference: result.reference, channel: adapter.channel },
      })
    }),
  )

  // Some channels acknowledge on upload, some queue. Both are supported
  // because the channel is not chosen yet, and the deletion job (E2.4) must
  // fire on the acknowledgement rather than on the upload either way.
  if (result.receipt) {
    await acknowledge({
      propertyId,
      reservationId,
      submissionId: staged.id,
      receipt: result.receipt,
      ...(input.actor ? { actor: input.actor } : {}),
    })

    return { status: 'acknowledged', submissionId: staged.id }
  }

  return { status: 'submitted', submissionId: staged.id }
}

/**
 * Records an acknowledgement.
 *
 * This is the signal E2.4 turns on: once the authority has accepted the
 * filing, the identity documents are no longer needed and the property should
 * not be holding them. The deletion itself is a separate job, because it
 * destroys files and that should be its own retryable step with its own
 * evidence — not a side effect buried in a receipt handler.
 */
async function acknowledge(input: {
  propertyId: string
  reservationId: string
  submissionId: string
  receipt: Record<string, unknown>
  actor?: Actor
}): Promise<void> {
  await asService((db) =>
    db.transaction(async (tx) => {
      await tx
        .update(alloggiatiSubmissions)
        .set({ status: 'acknowledged', acknowledgedAt: new Date(), receipt: input.receipt })
        .where(eq(alloggiatiSubmissions.id, input.submissionId))

      await applyJourneyCommandIn(tx, {
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        command: { type: 'alloggiati.acknowledge' },
        actor: input.actor ?? systemActor,
      })

      await emit(tx, {
        propertyId: input.propertyId,
        entityType: 'alloggiati_submission',
        entityId: input.submissionId,
        eventType: 'alloggiati.acknowledged',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: { reservationId: input.reservationId },
      })
    }),
  )
}

/**
 * Asks the channel about filings it has not answered yet.
 *
 * Only meaningful for a channel that queues. Cheap when there is nothing
 * outstanding, which is the normal case.
 */
export async function checkPendingAcknowledgements(
  deps: { adapter: AlloggiatiAdapter },
  input: { limit: number },
): Promise<{ checked: number; acknowledged: number }> {
  const pending = await asService((db) =>
    db
      .select({
        id: alloggiatiSubmissions.id,
        propertyId: alloggiatiSubmissions.propertyId,
        reservationId: alloggiatiSubmissions.reservationId,
        reference: externalRefs.externalId,
      })
      .from(alloggiatiSubmissions)
      .innerJoin(
        externalRefs,
        and(
          eq(externalRefs.entityId, alloggiatiSubmissions.id),
          eq(externalRefs.entityType, 'alloggiati_submission'),
          eq(externalRefs.system, deps.adapter.channel),
        ),
      )
      .where(eq(alloggiatiSubmissions.status, 'submitted'))
      .orderBy(asc(alloggiatiSubmissions.submittedAt))
      .limit(input.limit),
  )

  let acknowledged = 0

  for (const row of pending) {
    const result = await deps.adapter.checkAcknowledgement({
      propertyId: row.propertyId,
      reference: row.reference,
    })

    if (result.status !== 'acknowledged') continue

    await acknowledge({
      propertyId: row.propertyId,
      reservationId: row.reservationId,
      submissionId: row.id,
      receipt: result.receipt,
    })

    acknowledged += 1
  }

  return { checked: pending.length, acknowledged }
}

/**
 * Stays whose filing is overdue (E2.3: alert at T-20h if unconfirmed).
 *
 * Twenty hours after arrival, not twenty-four: the obligation is 24 hours, and
 * an alert that fires when the deadline has already passed is a notification of
 * a breach rather than a chance to avoid one.
 */
export async function listUnconfirmedAlloggiati(input: {
  hoursAfterArrival: number
  limit: number
  now?: Date
}): Promise<{ reservationId: string; propertyId: string; arrivalDate: string; state: string }[]> {
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - input.hoursAfterArrival * 3_600_000)

  return asService((db) =>
    db
      .select({
        reservationId: reservations.id,
        propertyId: reservations.propertyId,
        arrivalDate: reservations.arrivalDate,
        state: journeyStates.alloggiati,
      })
      .from(reservations)
      .innerJoin(journeyStates, eq(journeyStates.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          // Arrived, and long enough ago to be overdue. A guest still in
          // transit is not late.
          eq(journeyStates.arrival, 'confirmed'),
          lt(reservations.arrivalDate, isoDate(cutoff)),
          sql`${journeyStates.alloggiati} <> 'acknowledged'`,
        ),
      )
      .orderBy(asc(reservations.arrivalDate))
      .limit(input.limit),
  )
}

/**
 * Submissions whose documents can now be destroyed (E2.4).
 *
 * Acknowledged, and still holding at least one document. The job that acts on
 * this deletes objects, so it is deliberately a list to work through rather
 * than a single sweeping statement.
 */
export async function listDocumentsToDelete(input: {
  limit: number
}): Promise<{ propertyId: string; reservationId: string }[]> {
  return asService((db) =>
    db
      .selectDistinct({
        propertyId: alloggiatiSubmissions.propertyId,
        reservationId: alloggiatiSubmissions.reservationId,
      })
      .from(alloggiatiSubmissions)
      .innerJoin(
        registrationRecords,
        eq(registrationRecords.reservationId, alloggiatiSubmissions.reservationId),
      )
      .where(
        and(
          eq(alloggiatiSubmissions.status, 'acknowledged'),
          isNotNull(registrationRecords.documentPath),
        ),
      )
      .limit(input.limit),
  )
}

export interface DeleteOutcome {
  deleted: number
  failed: number
}

/**
 * Destroys the identity documents for one stay (E2.4).
 *
 * Takes a deleter rather than knowing what a bucket is: core records that the
 * deletion happened, the caller owns the storage. That separation is what lets
 * the retention policy be tested without a storage service and lets storage be
 * swapped without touching the audit trail.
 *
 * The object goes first, then the row. The other order would leave a row
 * claiming the document is gone while the file is still there — and the whole
 * point of this feature is being able to say truthfully that it is not.
 */
export async function deleteDocumentsForStay(
  deps: { deleteObject: (path: string) => Promise<boolean> },
  input: { propertyId: string; reservationId: string; actor?: Actor },
): Promise<DeleteOutcome> {
  const { propertyId, reservationId } = input

  const records = await asService((db) =>
    db
      .select({ id: registrationRecords.id, documentPath: registrationRecords.documentPath })
      .from(registrationRecords)
      .where(
        and(
          eq(registrationRecords.reservationId, reservationId),
          eq(registrationRecords.propertyId, propertyId),
          isNotNull(registrationRecords.documentPath),
        ),
      ),
  )

  let deleted = 0
  let failed = 0

  for (const record of records) {
    if (!record.documentPath) continue

    const gone = await deps.deleteObject(record.documentPath)

    if (!gone) {
      // Left exactly as it was. A row stamped deleted over a file that still
      // exists is a lie the product would then repeat to a supervisory
      // authority, and the retry will come round again.
      failed += 1
      continue
    }

    await asService((db) =>
      db
        .update(registrationRecords)
        .set({ documentPath: null, deletedAt: new Date() })
        .where(
          and(
            eq(registrationRecords.id, record.id),
            eq(registrationRecords.propertyId, propertyId),
          ),
        ),
    )

    deleted += 1
  }

  if (deleted > 0) {
    await asService((db) =>
      db.transaction(async (tx) => {
        await applyJourneyCommandIn(tx, {
          propertyId,
          reservationId,
          command: { type: 'documents.delete' },
          actor: input.actor ?? systemActor,
        })

        await emit(tx, {
          propertyId,
          entityType: 'reservation',
          entityId: reservationId,
          eventType: 'documents.deleted',
          origin: 'platform',
          actor: input.actor ?? systemActor,
          // E2.4 requires the deletion to be evented. This row is what a
          // property shows when asked to prove it holds nothing.
          payload: { documents: deleted, failed },
        })
      }),
    )
  }

  return { deleted, failed }
}

/** A person acting from the console, for the manual submit button (E2.3). */
export function consoleActor(userId: string): Actor {
  return userActor(userId)
}

/**
 * Our stored fields, as the record builder wants them.
 *
 * The translation lives here rather than in the form: a guest fills in a
 * person, and the registry's vocabulary is our problem.
 *
 * Exported because the console runs `validateParty` against the same mapping to
 * show an owner what is missing. Two mappings would eventually disagree, and
 * the disagreement would be a screen promising a filing that then fails.
 */
export function registrationToGuestDetails(data: unknown): Partial<GuestDetails> {
  if (data === null || typeof data !== 'object') return {}

  const record = data as Record<string, unknown>
  const text = (key: string): string | undefined =>
    typeof record[key] === 'string' && record[key].trim()
      ? (record[key] as string).trim()
      : undefined

  const sex = text('sex')
  const documentType = text('documentType')

  return {
    ...(text('surname') ? { surname: text('surname')! } : {}),
    ...(text('givenName') ? { givenName: text('givenName')! } : {}),
    ...(sex === 'm' || sex === 'f' ? { sex } : {}),
    ...(text('birthDate') ? { birthDate: text('birthDate')! } : {}),
    ...(text('birthPlace') ? { birthPlaceCode: text('birthPlace')! } : {}),
    ...(text('birthCountry') ? { birthCountryCode: text('birthCountry')! } : {}),
    ...(text('citizenship') ? { citizenshipCode: text('citizenship')! } : {}),
    ...(documentType === 'passport' ||
    documentType === 'idCard' ||
    documentType === 'drivingLicence'
      ? { documentType }
      : {}),
    ...(text('documentNumber') ? { documentNumber: text('documentNumber')! } : {}),
    ...(text('documentIssuer') ? { documentIssuerCode: text('documentIssuer')! } : {}),
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
