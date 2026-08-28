import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, closeConnection } from '../../client'
import { seed, type Fixture } from './support'
import { createHold } from '../../../booking/hold'
import { attachGuest, confirmReservation } from '../../../booking/confirm'
import { applyJourneyCommand, readJourney } from '../../../journey/apply'
import { recordDocument, saveParty } from '../../../journey/precheckin'
import {
  checkPendingAcknowledgements,
  deleteDocumentsForStay,
  listDocumentsToDelete,
  listUnconfirmedAlloggiati,
  stageAlloggiati,
  submitAlloggiati,
} from '../../../alloggiati/submit'
import { FakeAlloggiatiAdapter } from './fake-alloggiati-adapter'

/**
 * The Alloggiati chain against a real database (E2.3, E2.4).
 *
 * MEMO: nothing is filed with any authority — the adapter here is a local fake
 * standing in for the port, and the channel decision is still open. Everything
 * else is the shipping path: validation, the audit trail, the journey
 * transitions, retries, the overdue query, and the deletion that destroys real
 * personal data.
 *
 * The deletion tests matter most. E2.4 is a promise made to a guest whose
 * passport we are holding, and the failure mode worth guarding is the quiet
 * one: a row that says the document is gone while the file is still there.
 */

let fixture: Fixture

async function confirmedStay(propertyId: string, arrivalOffsetDays = 0): Promise<string> {
  const arrival = isoDate(Date.now() + arrivalOffsetDays * 86_400_000)
  const departure = isoDate(Date.now() + (arrivalOffsetDays + 2) * 86_400_000)

  const [room] = await db.execute<{ id: string }>(
    sql`select id from room_types where property_id = ${propertyId} and code = 'DBL'`,
  )

  const nights = []
  for (
    let t = Date.parse(`${arrival}T00:00:00Z`);
    t < Date.parse(`${departure}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    nights.push({ date, priceCents: 10_000, currency: 'EUR', snapshotId: `snap-${date}` })
  }

  const hold = await createHold({
    propertyId,
    roomTypeId: room!.id,
    arrival,
    departure,
    adults: 2,
    children: 0,
    nights,
  })
  if (hold.status !== 'held') throw new Error('fixture hold failed')

  await attachGuest({
    propertyId,
    reservationId: hold.reservationId,
    guest: { name: 'Rosa Weber', email: `rosa-${hold.reservationId}@example.test`, locale: 'en' },
  })

  const confirmed = await confirmReservation({ propertyId, reservationId: hold.reservationId })
  if (confirmed.status !== 'confirmed') throw new Error(`fixture confirm: ${confirmed.status}`)

  return hold.reservationId
}

/** A party complete enough to file, with documents attached. */
async function fileableStay(propertyId: string, arrivalOffsetDays = 0): Promise<string> {
  const reservationId = await confirmedStay(propertyId, arrivalOffsetDays)

  await saveParty({
    propertyId,
    reservationId,
    members: [
      {
        guestIndex: 0,
        surname: 'Weber',
        givenName: 'Rosa',
        sex: 'f',
        birthDate: '1985-04-12',
        birthCountry: 'AT',
        citizenship: 'AT',
        documentType: 'passport',
        documentNumber: 'P1234567',
      },
      {
        guestIndex: 1,
        surname: 'Weber',
        givenName: 'Hans',
        sex: 'm',
        birthDate: '1983-01-30',
        birthCountry: 'AT',
        citizenship: 'AT',
        documentType: 'idCard',
        documentNumber: 'ID998877',
      },
    ],
  })

  for (const guestIndex of [0, 1]) {
    await recordDocument({
      propertyId,
      reservationId,
      guestIndex,
      documentPath: `${propertyId}/${reservationId}/${guestIndex}`,
    })
  }

  await applyJourneyCommand({
    propertyId,
    reservationId,
    command: { type: 'arrival.confirm' },
  })

  return reservationId
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

beforeAll(async () => {
  fixture = await seed()
})

afterAll(async () => {
  await closeConnection()
})

describe('staging (E2.3)', () => {
  it('builds and records a payload for a complete party', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)
    const adapter = new FakeAlloggiatiAdapter()

    const staged = await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })

    expect(staged).toMatchObject({ status: 'staged', guestCount: 2 })

    const [row] = await db.execute<{
      status: string
      guest_count: number
      payload: string
      payload_checksum: string
    }>(
      sql`select status, guest_count, payload, payload_checksum
            from alloggiati_submissions where reservation_id = ${reservationId}`,
    )

    expect(row?.status).toBe('staged')
    expect(row?.guest_count).toBe(2)
    // The exact transmitted text is kept. When a guest's details are later
    // corrected, the records say one thing and the authority holds another —
    // and only this column can answer which.
    expect(row?.payload.split('\r\n')).toHaveLength(2)
    expect(row?.payload_checksum).toMatch(/^[0-9a-f]{64}$/)

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.alloggiati).toBe('staged')
  })

  it('reports every missing field rather than the first', async () => {
    const reservationId = await confirmedStay(fixture.alpha.propertyId)

    await saveParty({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      members: [{ guestIndex: 0, surname: 'Weber', givenName: 'Rosa' }],
    })

    const staged = await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: 'fake',
    })

    expect(staged.status).toBe('incomplete')
    if (staged.status !== 'incomplete') return

    // The owner has to go and ask the guest. A list that reveals one missing
    // field per round trip takes four conversations.
    expect(staged.issues.length).toBeGreaterThan(1)
    expect(staged.issues.map((issue) => issue.field)).toContain('sex')

    // Nothing recorded: an incomplete party is not a filing.
    const rows = await db.execute(
      sql`select id from alloggiati_submissions where reservation_id = ${reservationId}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('does not stage twice', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: 'fake',
    })
    const second = await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: 'fake',
    })

    // A second declaration for the same guests is the property's problem, not
    // a retry.
    expect(second.status).toBe('already-staged')
  })

  it('will not stage another property’s reservation', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)

    const staged = await stageAlloggiati({
      propertyId: fixture.beta.propertyId,
      reservationId,
      channel: 'fake',
    })

    expect(staged).toEqual({ status: 'rejected', reason: 'unknown reservation' })
  })
})

describe('filing (E2.3)', () => {
  it('files, records the reference, and acknowledges on upload', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)
    const adapter = new FakeAlloggiatiAdapter()

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })

    const filed = await submitAlloggiati(
      { adapter },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(filed.status).toBe('acknowledged')

    const [row] = await db.execute<{ status: string; receipt: unknown; acknowledged_at: string }>(
      sql`select status, receipt, acknowledged_at from alloggiati_submissions
           where reservation_id = ${reservationId}`,
    )
    expect(row?.status).toBe('acknowledged')
    // An acknowledgement without a receipt is not an acknowledgement — the
    // schema check says so too.
    expect(row?.receipt).toBeTruthy()

    const refs = await db.execute(
      sql`select id from external_refs
           where entity_type = 'alloggiati_submission'
             and property_id = ${fixture.alpha.propertyId}`,
    )
    // The channel's reference lives in external_refs like every foreign id.
    expect(refs.length).toBeGreaterThan(0)

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.alloggiati).toBe('acknowledged')
  })

  it('waits for a channel that queues', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)
    const adapter = new FakeAlloggiatiAdapter({ pendingChecks: 1 })

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })

    const filed = await submitAlloggiati(
      { adapter },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    // Submitted is not acknowledged. Collapsing them would fire the deletion
    // job on the wrong signal — and that job destroys evidence.
    expect(filed.status).toBe('submitted')

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.alloggiati).toBe('submitted')

    const first = await checkPendingAcknowledgements({ adapter }, { limit: 10 })
    expect(first.acknowledged).toBe(0)

    const second = await checkPendingAcknowledgements({ adapter }, { limit: 10 })
    expect(second.acknowledged).toBe(1)

    expect((await readJourney(fixture.alpha.propertyId, reservationId))?.alloggiati).toBe(
      'acknowledged',
    )
  })

  it('records a failure with a reason a person can act on', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)
    const adapter = new FakeAlloggiatiAdapter({ failSubmitTimes: 1 })

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })

    const filed = await submitAlloggiati(
      { adapter },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(filed.status).toBe('failed')

    const [row] = await db.execute<{ status: string; last_error: string; attempts: number }>(
      sql`select status, last_error, attempts from alloggiati_submissions
           where reservation_id = ${reservationId}`,
    )
    expect(row?.status).toBe('failed')
    expect(row?.last_error).toBeTruthy()
    expect(row?.attempts).toBe(1)

    // Retryable, and the retry works — a failed filing is not a dead one.
    const retried = await submitAlloggiati(
      { adapter },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )
    expect(retried.status).toBe('acknowledged')
  })

  it('does not file the same stay twice', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId)
    const adapter = new FakeAlloggiatiAdapter()

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })
    await submitAlloggiati({ adapter }, { propertyId: fixture.alpha.propertyId, reservationId })

    const second = await submitAlloggiati(
      { adapter },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    // A duplicate schedina is a compliance problem for the property, and the
    // authority has no interest in our retry policy.
    expect(second.status).toBe('already-done')
    expect(adapter.submitCount).toBe(1)
  })
})

describe('the T-20h alert (E2.3)', () => {
  it('lists a stay that arrived yesterday and is still unconfirmed', async () => {
    const overdue = await fileableStay(fixture.alpha.propertyId, -2)

    const rows = await listUnconfirmedAlloggiati({ hoursAfterArrival: 20, limit: 50 })

    expect(rows.map((row) => row.reservationId)).toContain(overdue)
  })

  it('does not list a guest who arrived an hour ago', async () => {
    const fresh = await fileableStay(fixture.alpha.propertyId, 0)

    const rows = await listUnconfirmedAlloggiati({ hoursAfterArrival: 20, limit: 50 })

    // A guest still settling in is not late. Listing them would train an owner
    // to ignore the section.
    expect(rows.map((row) => row.reservationId)).not.toContain(fresh)
  })

  it('drops a stay once it is acknowledged', async () => {
    const reservationId = await fileableStay(fixture.alpha.propertyId, -2)
    const adapter = new FakeAlloggiatiAdapter()

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })
    await submitAlloggiati({ adapter }, { propertyId: fixture.alpha.propertyId, reservationId })

    const rows = await listUnconfirmedAlloggiati({ hoursAfterArrival: 20, limit: 50 })

    expect(rows.map((row) => row.reservationId)).not.toContain(reservationId)
  })
})

describe('deleting identity documents (E2.4)', () => {
  async function acknowledgedStay(): Promise<string> {
    const reservationId = await fileableStay(fixture.alpha.propertyId)
    const adapter = new FakeAlloggiatiAdapter()

    await stageAlloggiati({
      propertyId: fixture.alpha.propertyId,
      reservationId,
      channel: adapter.channel,
    })
    await submitAlloggiati({ adapter }, { propertyId: fixture.alpha.propertyId, reservationId })

    return reservationId
  }

  it('only lists stays whose filing was acknowledged', async () => {
    const acknowledged = await acknowledgedStay()
    const notFiled = await fileableStay(fixture.alpha.propertyId)

    const due = await listDocumentsToDelete({ limit: 50 })
    const ids = due.map((row) => row.reservationId)

    expect(ids).toContain(acknowledged)
    // Deleting before the authority accepts the filing would destroy the data
    // needed to re-file it.
    expect(ids).not.toContain(notFiled)
  })

  it('destroys the objects, stamps the rows, and events it', async () => {
    const reservationId = await acknowledgedStay()
    const deleteObject = vi.fn(async () => true)

    const outcome = await deleteDocumentsForStay(
      { deleteObject },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(outcome).toEqual({ deleted: 2, failed: 0 })
    expect(deleteObject).toHaveBeenCalledTimes(2)

    const rows = await db.execute<{ document_path: string | null; deleted_at: string | null }>(
      sql`select document_path, deleted_at from registration_records
           where reservation_id = ${reservationId} order by guest_index`,
    )
    for (const row of rows) {
      expect(row.document_path).toBeNull()
      expect(row.deleted_at).toBeTruthy()
    }

    // E2.4 requires the deletion to be evented. This row is what a property
    // shows when asked to prove it holds nothing.
    const events = await db.execute(
      sql`select id from domain_events
           where entity_id = ${reservationId} and event_type = 'documents.deleted'`,
    )
    expect(events).toHaveLength(1)

    const journey = await readJourney(fixture.alpha.propertyId, reservationId)
    expect(journey?.documents).toBe('deleted')
  })

  it('leaves the row untouched when the object could not be destroyed', async () => {
    const reservationId = await acknowledgedStay()
    const deleteObject = vi.fn(async () => false)

    const outcome = await deleteDocumentsForStay(
      { deleteObject },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    expect(outcome).toEqual({ deleted: 0, failed: 2 })

    const rows = await db.execute<{ document_path: string | null; deleted_at: string | null }>(
      sql`select document_path, deleted_at from registration_records
           where reservation_id = ${reservationId}`,
    )

    // The failure mode worth guarding: a row claiming the document is gone
    // while the file is still there is a lie the product would then repeat to
    // a supervisory authority.
    for (const row of rows) {
      expect(row.document_path).not.toBeNull()
      expect(row.deleted_at).toBeNull()
    }
  })

  it('keeps the receipt after the documents are gone', async () => {
    const reservationId = await acknowledgedStay()

    await deleteDocumentsForStay(
      { deleteObject: async () => true },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    const [row] = await db.execute<{ receipt: unknown; payload_checksum: string }>(
      sql`select receipt, payload_checksum from alloggiati_submissions
           where reservation_id = ${reservationId}`,
    )

    // After the deletion this row is the entire remaining evidence that the
    // property met its obligation.
    expect(row?.receipt).toBeTruthy()
    expect(row?.payload_checksum).toBeTruthy()
  })

  it('is safe to run twice', async () => {
    const reservationId = await acknowledgedStay()
    const deleteObject = vi.fn(async () => true)

    await deleteDocumentsForStay(
      { deleteObject },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )
    const second = await deleteDocumentsForStay(
      { deleteObject },
      { propertyId: fixture.alpha.propertyId, reservationId },
    )

    // Nothing left to delete. The hourly job runs regardless of whether there
    // is work, and a second pass must not error or re-event.
    expect(second).toEqual({ deleted: 0, failed: 0 })
    expect(deleteObject).toHaveBeenCalledTimes(2)
  })

  it('will not delete another property’s documents', async () => {
    const reservationId = await acknowledgedStay()
    const deleteObject = vi.fn(async () => true)

    const outcome = await deleteDocumentsForStay(
      { deleteObject },
      { propertyId: fixture.beta.propertyId, reservationId },
    )

    expect(outcome).toEqual({ deleted: 0, failed: 0 })
    expect(deleteObject).not.toHaveBeenCalled()
  })
})
