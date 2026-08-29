import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  agentRuns,
  attributionEvents,
  discrepancies,
  domainEvents,
  guests,
  invoiceRequests,
  messages,
  messageThreads,
  notifications,
  registrationRecords,
  reservations,
  stayTasks,
} from '../db/schema'
import { asService } from '../db/session'
import { emit } from '../events/emitter'
import { systemActor, userActor, type Actor } from '../events/actor'
import { legalCarveOuts } from './data-map'

/**
 * Erasure (E8.1, Art. 17).
 *
 * ## Erasure is not deletion here, and saying otherwise would be the lie
 *
 * A reservation is fiscal-adjacent — ten years, PRD D6 — and an Alloggiati
 * submission is a filing with a public authority that we are not free to
 * unmake. Art. 17(3)(b) covers exactly this. So the person is removed and the
 * transaction stays: the guest row is anonymised in place, free text a guest
 * wrote is deleted outright, and the rows that have to survive survive with
 * nobody in them.
 *
 * Every carve-out is declared in the data map with the reason a supervisory
 * authority would be given, and the desk shows them to the owner **before** the
 * button rather than in a footnote after it.
 *
 * ## What "no person left" is checked to mean
 *
 * Not "we ran some updates". The test for this routine writes a guest into
 * every table that can hold one, erases, and then searches the whole database
 * for the name, the email and the phone number. Asserting the absence is the
 * only version of this that is worth anything, because the failure mode is a
 * column somebody forgot and no error anywhere.
 *
 * ## Storage
 *
 * Identity document objects are deleted through an injected deleter, the same
 * separation E2.4 uses: core records that the deletion happened and the caller
 * owns the bucket. The object goes first and the row second — the other order
 * produces a row claiming the document is gone while the file is still there,
 * which is the one claim this whole feature exists to be able to make.
 */

export interface ErasureDeps {
  /** Returns true when the object is gone (or was never there). */
  deleteObject: (path: string) => Promise<boolean>
}

export interface ErasureInput {
  propertyId: string
  guestId: string
  /** The owner who pressed it. Recorded on the event. */
  actor?: Actor
}

export interface ErasureOutcome {
  guestId: string
  /** Table → rows changed. Counts only; see the retention module for why. */
  applied: Record<string, number>
  /** Objects removed from storage, and objects the storage refused to remove. */
  documents: { deleted: number; failed: number }
  /** Table → the reason it was kept, straight from the data map. */
  carveOuts: Record<string, string>
}

/**
 * The carve-outs, read from the map rather than restated here.
 *
 * `legalCarveOuts()` and not every `keep`: the desk shows this same list before
 * the button, and an entry kept because there is nothing left in it once the
 * guest is anonymised — a journey state, a line on a bill — pads the list the
 * real ones are on. `fee_events` is out for a different reason: it is about the
 * property rather than the guest, so it is not a carve-out from *their* request
 * at all.
 */
function carveOuts(): Record<string, string> {
  const kept: Record<string, string> = {}

  for (const entry of legalCarveOuts()) {
    if (entry.erasure.kind === 'keep') kept[entry.table] = entry.erasure.why
  }

  return kept
}

/**
 * Erases one guest at one property.
 *
 * Not a single transaction, deliberately. Storage deletion cannot participate
 * in one, and a transaction that spans an HTTP call to a bucket is a lock held
 * for as long as somebody else's service takes to answer. The order is chosen
 * so that every interruption leaves a state that is *more* erased than before,
 * never a half-anonymised guest with their messages intact.
 */
export async function eraseGuest(deps: ErasureDeps, input: ErasureInput): Promise<ErasureOutcome> {
  const { propertyId, guestId } = input
  const applied: Record<string, number> = {}

  /*
   * Every id this erasure touched, for the event-log pass at the end.
   *
   * `domain_events.entity_id` points at whatever the event was about — a
   * message, a registration record, a notification, not only a reservation. So
   * the log pass needs the ids of the rows we removed, collected as we go,
   * because after they are gone there is no way back to them.
   */
  const touched = new Set<string>([guestId])

  const record = (table: string, rows: { id: string }[]) => {
    applied[table] = (applied[table] ?? 0) + rows.length
    for (const row of rows) touched.add(row.id)
  }

  const [guest] = await asService((db) =>
    db
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.propertyId, propertyId))),
  )

  if (!guest) throw new Error('No such guest at this property')

  const stays = await asService((db) =>
    db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.guestId, guestId), eq(reservations.propertyId, propertyId))),
  )

  const stayIds = stays.map((stay) => stay.id)
  for (const id of stayIds) touched.add(id)

  // ---------------------------------------------------------------------
  // Documents first
  // ---------------------------------------------------------------------
  // Before anything else, because it is the step that can fail on somebody
  // else's service. Failing here with the rest of the erasure not yet done
  // leaves a request that is honestly incomplete, which is the state the retry
  // is for. Failing here *after* anonymising the guest would leave an object
  // in a bucket that nothing in the database still points at.
  const documents = { deleted: 0, failed: 0 }

  if (stayIds.length > 0) {
    const withDocuments = await asService((db) =>
      db
        .select({ id: registrationRecords.id, documentPath: registrationRecords.documentPath })
        .from(registrationRecords)
        .where(
          and(
            inArray(registrationRecords.reservationId, stayIds),
            eq(registrationRecords.propertyId, propertyId),
            isNotNull(registrationRecords.documentPath),
          ),
        ),
    )

    for (const row of withDocuments) {
      if (!row.documentPath) continue

      if (await deps.deleteObject(row.documentPath)) {
        documents.deleted += 1
      } else {
        documents.failed += 1
      }
    }
  }

  if (stayIds.length > 0) {
    // -------------------------------------------------------------------
    // The agent runs behind the conversation, collected before it is deleted
    // -------------------------------------------------------------------
    // `messages.agent_run_id` is the only path from a guest to the runs that
    // answered them. Deleting the messages first would strand those runs with
    // the guest's words still in `output`, unreachable and unerased — the exact
    // shape of a residue nobody finds until an audit.
    const threads = await asService((db) =>
      db
        .select({ id: messageThreads.id })
        .from(messageThreads)
        .where(
          and(
            inArray(messageThreads.reservationId, stayIds),
            eq(messageThreads.propertyId, propertyId),
          ),
        ),
    )

    const threadIds = threads.map((thread) => thread.id)

    const runIds =
      threadIds.length === 0
        ? []
        : (
            await asService((db) =>
              db
                .selectDistinct({ id: messages.agentRunId })
                .from(messages)
                .where(
                  and(
                    inArray(messages.threadId, threadIds),
                    eq(messages.propertyId, propertyId),
                    isNotNull(messages.agentRunId),
                  ),
                ),
            )
          )
            .map((row) => row.id)
            .filter((id): id is string => id !== null)

    if (threadIds.length > 0) {
      record(
        'messages',
        await asService((db) =>
          db
            .delete(messages)
            .where(and(inArray(messages.threadId, threadIds), eq(messages.propertyId, propertyId)))
            .returning({ id: messages.id }),
        ),
      )

      record(
        'message_threads',
        await asService((db) =>
          db
            .update(messageThreads)
            .set({ escalationReason: null })
            .where(
              and(inArray(messageThreads.id, threadIds), eq(messageThreads.propertyId, propertyId)),
            )
            .returning({ id: messageThreads.id }),
        ),
      )
    }

    if (runIds.length > 0) {
      record(
        'agent_runs',
        await asService((db) =>
          db
            .update(agentRuns)
            .set({ toolCalls: [], output: {} })
            .where(and(inArray(agentRuns.id, runIds), eq(agentRuns.propertyId, propertyId)))
            .returning({ id: agentRuns.id }),
        ),
      )
    }

    record(
      'stay_tasks',
      await asService((db) =>
        db
          .delete(stayTasks)
          .where(
            and(inArray(stayTasks.reservationId, stayIds), eq(stayTasks.propertyId, propertyId)),
          )
          .returning({ id: stayTasks.id }),
      ),
    )

    // Counted directly rather than through `record`: `attribution_events.id` is
    // a bigserial, and nothing in `domain_events` ever points at one.
    applied.attribution_events = (
      await asService((db) =>
        db
          .delete(attributionEvents)
          .where(
            and(
              inArray(attributionEvents.reservationId, stayIds),
              eq(attributionEvents.propertyId, propertyId),
            ),
          )
          .returning({ id: attributionEvents.id }),
      )
    ).length

    record(
      'notifications',
      await asService((db) =>
        db
          .update(notifications)
          .set({ recipient: '—', payload: {} })
          .where(
            and(
              inArray(notifications.reservationId, stayIds),
              eq(notifications.propertyId, propertyId),
            ),
          )
          .returning({ id: notifications.id }),
      ),
    )

    /*
     * The billing details, which the first version of this routine kept.
     *
     * The data map claimed a carve-out on the grounds that the property issues
     * the actual invoice and keeps their own copy. True, and beside the point:
     * ours is a routing record, not the fiscal document, and it was sitting
     * there with the guest's name in a column called `bill_to`. The
     * whole-database search found it, which is what that test is for.
     */
    record(
      'invoice_requests',
      await asService((db) =>
        db
          .update(invoiceRequests)
          .set({ billTo: '—', details: {} })
          .where(
            and(
              inArray(invoiceRequests.reservationId, stayIds),
              eq(invoiceRequests.propertyId, propertyId),
            ),
          )
          .returning({ id: invoiceRequests.id }),
      ),
    )

    record(
      'registration_records',
      await asService((db) =>
        db
          .update(registrationRecords)
          .set({ data: {}, documentPath: null, deletedAt: sql`now()` })
          .where(
            and(
              inArray(registrationRecords.reservationId, stayIds),
              eq(registrationRecords.propertyId, propertyId),
            ),
          )
          .returning({ id: registrationRecords.id }),
      ),
    )

    /*
     * Discrepancies name the reservation they are about in `entity_ref` as
     * `reservation:{uuid}` — text, not a foreign key, because the other side of
     * a discrepancy may be a row that does not exist here at all. So this
     * matches on the string, which is the only handle there is.
     */
    record(
      'discrepancies',
      await asService((db) =>
        db
          .update(discrepancies)
          .set({ ours: null, theirs: null })
          .where(
            and(
              eq(discrepancies.propertyId, propertyId),
              inArray(
                discrepancies.entityRef,
                stayIds.map((id) => `reservation:${id}`),
              ),
            ),
          )
          .returning({ id: discrepancies.id }),
      ),
    )

    /*
     * The event log keeps its rows and loses its payloads, for events about
     * this guest's own entities.
     *
     * What survives is that something happened to a reservation, by whom and
     * when — which is pseudonymous once the guest is anonymised, and is the
     * basis of G1, the agent audit trail and the attribution report that is the
     * invoice. Deleting these rows would put a hole in an append-only log whose
     * whole value is having none.
     */
    const cleared = await asService((db) =>
      db
        .update(domainEvents)
        .set({ payload: {} })
        .where(
          and(
            eq(domainEvents.propertyId, propertyId),
            inArray(domainEvents.entityId, [...touched]),
            sql`${domainEvents.payload} <> '{}'::jsonb`,
          ),
        )
        .returning({ id: domainEvents.id }),
    )

    // Not through `record`: `domain_events.id` is a bigserial and these ids are
    // not entity ids, so adding them to `touched` would be adding numbers to a
    // set of uuids — harmless today and a very confusing bug the first time
    // something reads it.
    applied.domain_events = cleared.length
  }

  // ---------------------------------------------------------------------
  // The guest, last
  // ---------------------------------------------------------------------
  // Anonymised rather than deleted: every reservation points here with
  // `restrict`, and the reservation is the row we are required to keep.
  //
  // Last, because until this runs the request is unmistakably unfinished. A
  // partially-erased guest whose row still names them is a state a retry fixes;
  // an anonymised guest whose messages survived is one nobody would notice.
  record(
    'guests',
    await asService((db) =>
      db
        .update(guests)
        .set({ name: '—', email: null, phone: null, locale: null, marketingConsent: false })
        .where(and(eq(guests.id, guestId), eq(guests.propertyId, propertyId)))
        .returning({ id: guests.id }),
    ),
  )

  const outcome: ErasureOutcome = {
    guestId,
    applied,
    documents,
    carveOuts: carveOuts(),
  }

  /*
   * The event, emitted after and deliberately not part of the work above.
   *
   * It is the evidence the erasure happened and it must survive it, so its
   * payload carries counts and carve-out reasons — nothing that names the
   * person the request was about. `entityId` is the guest id, which after this
   * points at a row with nobody behind it.
   */
  await asService((db) =>
    db.transaction((tx) =>
      emit(tx, {
        propertyId,
        entityType: 'guest',
        entityId: guestId,
        eventType: 'guest.erased',
        origin: 'platform',
        actor: input.actor ?? systemActor,
        payload: {
          applied,
          documents,
          carveOuts: Object.keys(outcome.carveOuts),
          reservations: stayIds.length,
        },
      }),
    ),
  )

  return outcome
}

/** The actor helper the console passes, so the desk does not build one itself. */
export function ownerActor(userId: string): Actor {
  return userActor(userId)
}
