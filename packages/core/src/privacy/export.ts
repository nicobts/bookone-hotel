import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  attributionEvents,
  guests,
  invoiceRequests,
  journeyStates,
  messages,
  messageThreads,
  notifications,
  payments,
  privacyRequests,
  registrationRecords,
  reservations,
  stayExtras,
  stayTasks,
  alloggiatiSubmissions,
} from '../db/schema'
import { asService } from '../db/session'
import { DATA_MAP, entryFor } from './data-map'

/**
 * The subject access bundle (E8.1, Art. 15 and Art. 20).
 *
 * Everything one property holds about one guest, as JSON, with a manifest that
 * says what is in it and what is deliberately not.
 *
 * ## Why the manifest matters more than the data
 *
 * A data subject who receives an export cannot tell whether it is complete.
 * Sixteen sections of JSON and no index is a sample, not an export, and the
 * only thing separating the two is a statement of what was looked at. So the
 * manifest lists **every table in the data map**, including the ones with
 * nothing in them and the ones deliberately excluded, with the reason. Absence
 * is reported, never implied.
 *
 * ## Per property, and that is a feature
 *
 * A guest who stayed at two properties on the platform is two guest rows
 * (`guests.property_id`). Each property is a separate controller answering for
 * its own processing, and an export that reached across them would be one
 * hotel handing over another hotel's records. Stated in the design note §2 and
 * enforced by every query below carrying `property_id`.
 *
 * ## Never stored
 *
 * Built, returned, forgotten. A stored bundle is a copy of everything we hold
 * about one person sitting in a bucket, which is the highest-value object in
 * the system and the shape of every "the export feature caused the breach"
 * incident.
 */

export interface ManifestLine {
  table: string
  /** `included`, `empty`, or `excluded`. */
  state: 'included' | 'empty' | 'excluded'
  records: number
  /** Plain language, for the response the property sends with the file. */
  note: string
}

export interface GuestExport {
  /** What this is, in the words the covering response repeats. */
  about: {
    subject: string
    property: string
    generatedAt: string
    statement: string
  }
  manifest: ManifestLine[]
  data: Record<string, unknown[]>
}

/**
 * Columns we never put in a bundle even though they are on rows we do.
 *
 * `document_path` is a pointer into a private bucket. Handing a data subject
 * the path to an object they cannot fetch tells them nothing and tells anybody
 * else who reads the file the layout of our storage.
 */
const WITHHELD: Record<string, string[]> = {
  registration_records: ['documentPath'],
}

function withhold(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const columns = WITHHELD[table]
  if (!columns) return rows

  return rows.map((row) => {
    const copy = { ...row }
    for (const column of columns) delete copy[column]
    return copy
  })
}

export interface ExportInput {
  propertyId: string
  guestId: string
}

/**
 * Builds the bundle.
 *
 * Runs under the service role because it deliberately reaches tables a session
 * cannot write and joins across a guest's whole history — and every statement
 * carries `property_id` anyway (binding rule 3, which the service role does not
 * relax).
 */
export async function buildGuestExport(input: ExportInput): Promise<GuestExport> {
  const { propertyId, guestId } = input

  const data: Record<string, unknown[]> = {}

  const [guest] = await asService((db) =>
    db
      .select()
      .from(guests)
      .where(and(eq(guests.id, guestId), eq(guests.propertyId, propertyId))),
  )

  if (!guest) {
    throw new Error('No such guest at this property')
  }

  data.guests = [guest]

  const stays = await asService((db) =>
    db
      .select()
      .from(reservations)
      .where(and(eq(reservations.guestId, guestId), eq(reservations.propertyId, propertyId))),
  )

  data.reservations = stays

  const stayIds = stays.map((stay) => stay.id)

  /*
   * An empty `in ()` is a syntax error in Postgres and a silent full scan in
   * some ORMs. A guest with no reservations is an ordinary case — somebody who
   * enquired and never booked — so it is handled once, here, rather than at
   * each of the ten queries below.
   */
  const byStay = async <T>(run: (ids: string[]) => Promise<T[]>): Promise<T[]> =>
    stayIds.length === 0 ? [] : run(stayIds)

  data.journey_states = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(journeyStates)
        .where(
          and(inArray(journeyStates.reservationId, ids), eq(journeyStates.propertyId, propertyId)),
        ),
    ),
  )

  data.registration_records = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(registrationRecords)
        .where(
          and(
            inArray(registrationRecords.reservationId, ids),
            eq(registrationRecords.propertyId, propertyId),
          ),
        ),
    ),
  )

  data.alloggiati_submissions = await byStay((ids) =>
    asService((db) =>
      db
        .select({
          id: alloggiatiSubmissions.id,
          reservationId: alloggiatiSubmissions.reservationId,
          status: alloggiatiSubmissions.status,
          guestCount: alloggiatiSubmissions.guestCount,
          channel: alloggiatiSubmissions.channel,
          submittedAt: alloggiatiSubmissions.submittedAt,
          acknowledgedAt: alloggiatiSubmissions.acknowledgedAt,
          receipt: alloggiatiSubmissions.receipt,
        })
        .from(alloggiatiSubmissions)
        .where(
          and(
            inArray(alloggiatiSubmissions.reservationId, ids),
            eq(alloggiatiSubmissions.propertyId, propertyId),
          ),
        ),
    ),
  )

  data.payments = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(payments)
        .where(and(inArray(payments.reservationId, ids), eq(payments.propertyId, propertyId))),
    ),
  )

  data.stay_extras = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(stayExtras)
        .where(and(inArray(stayExtras.reservationId, ids), eq(stayExtras.propertyId, propertyId))),
    ),
  )

  data.invoice_requests = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(invoiceRequests)
        .where(
          and(
            inArray(invoiceRequests.reservationId, ids),
            eq(invoiceRequests.propertyId, propertyId),
          ),
        ),
    ),
  )

  data.attribution_events = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(attributionEvents)
        .where(
          and(
            inArray(attributionEvents.reservationId, ids),
            eq(attributionEvents.propertyId, propertyId),
          ),
        ),
    ),
  )

  data.notifications = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(notifications)
        .where(
          and(inArray(notifications.reservationId, ids), eq(notifications.propertyId, propertyId)),
        ),
    ),
  )

  data.stay_tasks = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(stayTasks)
        .where(and(inArray(stayTasks.reservationId, ids), eq(stayTasks.propertyId, propertyId))),
    ),
  )

  const threads = await byStay((ids) =>
    asService((db) =>
      db
        .select()
        .from(messageThreads)
        .where(
          and(
            inArray(messageThreads.reservationId, ids),
            eq(messageThreads.propertyId, propertyId),
          ),
        ),
    ),
  )

  data.message_threads = threads

  const threadIds = threads.map((thread) => thread.id)

  data.messages =
    threadIds.length === 0
      ? []
      : await asService((db) =>
          db
            .select()
            .from(messages)
            .where(and(inArray(messages.threadId, threadIds), eq(messages.propertyId, propertyId)))
            .orderBy(messages.createdAt),
        )

  data.privacy_requests = await asService((db) =>
    db
      .select()
      .from(privacyRequests)
      .where(and(eq(privacyRequests.guestId, guestId), eq(privacyRequests.propertyId, propertyId))),
  )

  return {
    about: {
      subject: guestId,
      property: propertyId,
      generatedAt: await databaseNow(),
      statement: STATEMENT,
    },
    manifest: buildManifest(data),
    data: Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [
        table,
        withhold(table, rows as Record<string, unknown>[]),
      ]),
    ),
  }
}

/**
 * The database's clock, not the process's.
 *
 * Every timestamp inside the bundle was written by Postgres. A `generatedAt`
 * from `new Date()` sits beside them differing by whatever the skew happens to
 * be — around six hundred milliseconds on this machine — and the one document
 * whose purpose is being checkable should not contain two clocks.
 */
async function databaseNow(): Promise<string> {
  const rows = (await asService((db) => db.execute(sql`select now() as at`))) as unknown as {
    at: Date | string
  }[]

  const at = rows[0]?.at

  return at instanceof Date ? at.toISOString() : String(at)
}

const STATEMENT = [
  'This file contains the personal data this property holds about one guest.',
  'It is generated on request and not stored. The manifest lists every table',
  'in our data map, including those with no records and those excluded, with',
  'the reason for each exclusion.',
].join(' ')

/**
 * The manifest — every table in the map, not every table with rows.
 *
 * The excluded ones are the point. "We hold nothing about you in our event log"
 * and "we did not look at our event log" produce identical exports, and only
 * one of them is an answer.
 */
function buildManifest(data: Record<string, unknown[]>): ManifestLine[] {
  return DATA_MAP.map((entry) => {
    if (entry.exportVia === 'none') {
      return {
        table: entry.table,
        state: 'excluded' as const,
        records: 0,
        note:
          entry.subject === 'guest'
            ? `Holds data about you but is excluded: ${excluded(entry.table)}`
            : 'Holds no personal data about a guest.',
      }
    }

    const rows = data[entry.table] ?? []

    return {
      table: entry.table,
      state: rows.length > 0 ? ('included' as const) : ('empty' as const),
      records: rows.length,
      note: entryFor(entry.table)?.basis ?? '',
    }
  })
}

/**
 * Why a guest-bearing table is not in the bundle.
 *
 * Three of them, each for a different reason, and each reason is one a data
 * subject is entitled to be given rather than left to infer. Art. 15(4): the
 * right to a copy shall not adversely affect the rights of others — which is
 * what the second and third of these are about.
 */
function excluded(table: string): string {
  switch (table) {
    case 'domain_events':
      return 'our internal audit log of processing. It records that actions happened, by whom and when, and its entries about you are already represented by the records above.'
    case 'agent_runs':
      return 'the audit record of our automated systems, including their cost and their evaluation history. Its guest-facing content is the messages above.'
    case 'discrepancies':
      return 'engineering records of disagreements between this property’s systems. They contain snapshots of the same reservations shown above.'
    default:
      return 'excluded by our data map.'
  }
}
