import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, closeConnection } from '../../client'
import { withUser } from '../../session'
import { expectPolicyRefusal, seed, selectAs, type Fixture } from './support'
import { recordManualFiling, receiptHash } from '../../../compliance/obligations'
import { complianceToday, inspectionExport } from '../../../compliance/dashboard'
import { purgeReceiptFiles } from '../../../compliance/receipts'
import { receiptPath } from '../../../storage/receipts'

/**
 * WP1.6 against a real database: the dashboard, the inspection export, the
 * manual filing with its uploaded receipt, and the two-year purge of the file.
 *
 * The fallback drill, per adapter: an obligation handed to a person
 * (`manual`) is filed by hand, recorded with its receipt and file, and then
 * appears in the period's export with that receipt. Nothing is filed with any
 * authority; the obligations are written directly, as the lifecycle would have
 * left them.
 */
let fixture: Fixture
const ADAPTERS = ['alloggiati', 'webtur-fvg']
const now = new Date('2026-06-10T10:00:00Z')

async function obligation(input: {
  propertyId: string
  adapterId: 'alloggiati' | 'webtur-fvg'
  state: string
  deadline: string
  key: string
  stateChangedAt?: string
}): Promise<string> {
  const day = input.adapterId === 'webtur-fvg'
  const [row] = await db.execute<{ id: string }>(sql`
    insert into compliance_obligations
      (property_id, adapter_id, authority, type, subject_key, period_date, deadline, state, state_changed_at)
    values (
      ${input.propertyId}, ${input.adapterId},
      ${day ? 'regione-fvg' : 'questura'},
      ${day ? 'istat_movement' : 'guest_registration'},
      ${day ? `day:${input.key}` : `reservation:${input.key}`},
      ${day ? input.key : null},
      ${input.deadline}, ${input.state}, ${input.stateChangedAt ?? '2026-06-09T08:00:00Z'})
    returning id`)
  return row!.id
}

let alloggiatiManual: string
let webturManual: string

beforeAll(async () => {
  fixture = await seed()
  const alpha = fixture.alpha.propertyId

  alloggiatiManual = await obligation({
    propertyId: alpha,
    adapterId: 'alloggiati',
    state: 'manual',
    deadline: '2026-06-10T20:00:00Z',
    key: '00000000-0000-0000-0000-000000000001',
  })
  webturManual = await obligation({
    propertyId: alpha,
    adapterId: 'webtur-fvg',
    state: 'manual',
    deadline: '2026-06-09T21:59:59Z',
    key: '2026-06-08',
  })
  await obligation({
    propertyId: alpha,
    adapterId: 'alloggiati',
    state: 'pending',
    deadline: '2026-06-11T20:00:00Z',
    key: '00000000-0000-0000-0000-000000000002',
  })
  await obligation({
    propertyId: alpha,
    adapterId: 'webtur-fvg',
    state: 'submitted',
    deadline: '2026-06-10T21:59:59Z',
    key: '2026-06-09',
  })
  // Beta's, which alpha never sees.
  await obligation({
    propertyId: fixture.beta.propertyId,
    adapterId: 'alloggiati',
    state: 'manual',
    deadline: '2026-06-10T20:00:00Z',
    key: '00000000-0000-0000-0000-000000000003',
  })
}, 60_000)

afterAll(async () => {
  await closeConnection()
})

describe('the dashboard', () => {
  it('counts the day per authority, for the member’s own property', async () => {
    const today = await complianceToday(fixture.alpha.user.id, fixture.alpha.propertyId, {
      adapterIds: ADAPTERS,
      timeZone: 'Europe/Rome',
      now,
    })
    expect(today.date).toBe('2026-06-10')
    expect(today.authorities).toEqual([
      {
        adapterId: 'alloggiati',
        authority: 'questura',
        dueToday: 1,
        overdue: 0,
        submitted: 0,
        failed: 1,
        acknowledgedToday: 0,
      },
      {
        adapterId: 'webtur-fvg',
        authority: 'regione-fvg',
        dueToday: 0,
        overdue: 1,
        submitted: 1,
        failed: 1,
        acknowledgedToday: 0,
      },
    ])
    expect(today.open).toHaveLength(4)
  })

  it('shows nothing of a module that is off, and nothing of another property', async () => {
    const onlyAlloggiati = await complianceToday(fixture.alpha.user.id, fixture.alpha.propertyId, {
      adapterIds: ['alloggiati'],
      timeZone: 'Europe/Rome',
      now,
    })
    expect(onlyAlloggiati.authorities.map((a) => a.adapterId)).toEqual(['alloggiati'])

    // Alpha's member asking for beta's property: RLS returns nothing.
    const other = await complianceToday(fixture.alpha.user.id, fixture.beta.propertyId, {
      adapterIds: ADAPTERS,
      timeZone: 'Europe/Rome',
      now,
    })
    expect(other.authorities).toEqual([])
  })
})

describe('the fallback drill, per adapter', () => {
  it('files each by hand, with the receipt and its file, and the export has them', async () => {
    const alpha = fixture.alpha.propertyId
    const recorded = []
    for (const obligationId of [alloggiatiManual, webturManual]) {
      recorded.push(
        await recordManualFiling({
          propertyId: alpha,
          obligationId,
          userId: fixture.alpha.user.id,
          receipt: { protocol: `P-${obligationId.slice(0, 4)}`, filedOn: '2026-06-10' },
          attachment: {
            path: receiptPath({ propertyId: alpha, obligationId }),
            contentType: 'application/pdf',
            sizeBytes: 1234,
            sha256: 'f'.repeat(64),
          },
          now,
        }),
      )
    }
    expect(recorded.map((r) => r.status)).toEqual(['recorded', 'recorded'])

    const june = await inspectionExport(fixture.alpha.user.id, alpha, {
      from: '2026-06-01',
      to: '2026-06-30',
      timeZone: 'Europe/Rome',
      adapterIds: ADAPTERS,
    })
    expect(june.counts).toEqual({ total: 4, acknowledged: 2, open: 2, withoutEvidence: 0 })

    // Every acknowledged filing carries its receipt, whose hash covers the file's.
    for (const row of june.rows.filter((r) => r.state === 'acknowledged')) {
      expect(row.evidence).not.toBeNull()
      expect(row.evidence!.receipt).toMatchObject({
        attachment: { sha256: 'f'.repeat(64), contentType: 'application/pdf', sizeBytes: 1234 },
      })
      expect(row.evidence!.hash).toBe(receiptHash(row.evidence!.receipt))
      expect(row.attachment).toEqual({
        sha256: 'f'.repeat(64),
        contentType: 'application/pdf',
        deletedAt: null,
      })
    }
    expect(june.rows.map((r) => r.adapterId).sort()).toEqual([
      'alloggiati',
      'alloggiati',
      'webtur-fvg',
      'webtur-fvg',
    ])

    // The period is the property's days: nothing of May, nothing of beta.
    const may = await inspectionExport(fixture.alpha.user.id, alpha, {
      from: '2026-05-01',
      to: '2026-05-31',
      timeZone: 'Europe/Rome',
      adapterIds: ADAPTERS,
    })
    expect(may.rows).toEqual([])
    const beta = await inspectionExport(fixture.alpha.user.id, fixture.beta.propertyId, {
      from: '2026-06-01',
      to: '2026-06-30',
      timeZone: 'Europe/Rome',
      adapterIds: ADAPTERS,
    })
    expect(beta.rows).toEqual([])
  })

  it('refuses to record twice', async () => {
    expect(
      await recordManualFiling({
        propertyId: fixture.alpha.propertyId,
        obligationId: alloggiatiManual,
        userId: fixture.alpha.user.id,
        receipt: { protocol: 'again' },
      }),
    ).toEqual({ status: 'rejected', reason: 'already acknowledged' })
  })
})

describe('the receipt files', () => {
  it('are readable by the property’s members only — both paths — and writable by none', async () => {
    const rows = (await selectAs(fixture.alpha.user, 'compliance_attachments')) as {
      property_id: string
    }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.property_id === fixture.alpha.propertyId)).toBe(true)
    expect(await selectAs(fixture.beta.user, 'compliance_attachments')).toEqual([])

    const [seen] = await withUser(fixture.beta.user.id, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from compliance_attachments`),
    )
    expect(seen!.n).toBe(0)

    await expectPolicyRefusal(() =>
      withUser(fixture.alpha.user.id, (tx) =>
        tx.execute(sql`update compliance_attachments set deleted_at = now()`),
      ),
    )
  })

  it('go at two years; the row and the evidence hash stay', async () => {
    const deleted: string[] = []
    const early = await purgeReceiptFiles(
      { deleteObject: async (path) => (deleted.push(path), true) },
      { now: new Date('2028-06-01T00:00:00Z') },
    )
    expect(early).toEqual({ deleted: 0, failed: 0 })

    // A storage failure stamps nothing.
    const refused = await purgeReceiptFiles(
      { deleteObject: async () => false },
      { now: new Date('2028-06-11T00:00:00Z') },
    )
    expect(refused).toEqual({ deleted: 0, failed: 2 })

    const later = await purgeReceiptFiles(
      { deleteObject: async (path) => (deleted.push(path), true) },
      { now: new Date('2028-06-11T00:00:00Z') },
    )
    expect(later).toEqual({ deleted: 2, failed: 0 })
    expect(deleted.every((path) => path.startsWith(`${fixture.alpha.propertyId}/`))).toBe(true)

    const june = await inspectionExport(fixture.alpha.user.id, fixture.alpha.propertyId, {
      from: '2026-06-01',
      to: '2026-06-30',
      timeZone: 'Europe/Rome',
      adapterIds: ADAPTERS,
    })
    const filed = june.rows.filter((r) => r.state === 'acknowledged')
    expect(filed.every((r) => r.attachment?.deletedAt instanceof Date)).toBe(true)
    expect(
      filed.every(
        (r) => r.evidence !== null && r.evidence.hash === receiptHash(r.evidence.receipt),
      ),
    ).toBe(true)

    const [events] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from domain_events where event_type = 'compliance_attachment.deleted'`,
    )
    expect(events!.n).toBe(2)
  })
})
