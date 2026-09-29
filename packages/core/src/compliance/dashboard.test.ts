import { describe, expect, it } from 'vitest'
import {
  inspectionCsv,
  summariseToday,
  type DashboardRow,
  type InspectionExport,
} from './dashboard'

/** WP1.6: the day's counts per authority, and the inspection export's file. */
const now = new Date('2026-06-10T10:00:00Z')
const window = {
  now,
  dayStart: new Date('2026-06-09T22:00:00Z'),
  dayEnd: new Date('2026-06-10T22:00:00Z'),
}

let seq = 0
function row(over: Partial<DashboardRow>): DashboardRow {
  seq += 1
  return {
    id: `o${seq}`,
    adapterId: 'alloggiati',
    authority: 'questura',
    type: 'guest_registration',
    state: 'pending',
    deadline: new Date('2026-06-10T20:00:00Z'),
    stateChangedAt: new Date('2026-06-09T08:00:00Z'),
    lastError: null,
    reservationId: 'r',
    reference: `BK-${seq}`,
    periodDate: null,
    subjectKey: 'reservation:r',
    ...over,
  }
}

describe('the day, per authority', () => {
  it('counts due, overdue, submitted, failed and acknowledged today', () => {
    const rows = [
      row({}), // due today
      row({ state: 'queued', deadline: new Date('2026-06-10T21:59:00Z') }), // due today
      row({ deadline: new Date('2026-06-11T08:00:00Z') }), // open, due tomorrow
      row({ state: 'failed', deadline: new Date('2026-06-10T09:00:00Z') }), // overdue + failed
      row({ state: 'manual', deadline: new Date('2026-06-10T15:00:00Z') }), // due today + failed
      row({ state: 'submitted' }),
      row({ state: 'acknowledged', stateChangedAt: new Date('2026-06-10T06:00:00Z') }),
      row({ state: 'acknowledged', stateChangedAt: new Date('2026-06-09T21:00:00Z') }), // yesterday
      row({
        adapterId: 'webtur-fvg',
        authority: 'regione-fvg',
        type: 'istat_movement',
        reservationId: null,
        reference: null,
        periodDate: '2026-06-09',
        subjectKey: 'day:2026-06-09',
        deadline: new Date('2026-06-10T21:59:59Z'),
      }),
    ]

    const { authorities, open } = summariseToday(rows, window)
    expect(authorities).toEqual([
      {
        adapterId: 'alloggiati',
        authority: 'questura',
        dueToday: 3,
        overdue: 1,
        submitted: 1,
        failed: 2,
        acknowledgedToday: 1,
      },
      {
        adapterId: 'webtur-fvg',
        authority: 'regione-fvg',
        dueToday: 1,
        overdue: 0,
        submitted: 0,
        failed: 0,
        acknowledgedToday: 0,
      },
    ])

    // Everything not acknowledged, soonest first, the overdue one flagged.
    expect(open.map((o) => [o.state, o.overdue])).toEqual([
      ['failed', true],
      ['manual', false],
      ['pending', false],
      ['submitted', false],
      ['queued', false],
      ['pending', false],
      ['pending', false],
    ])
  })

  it('is empty when nothing is owed', () => {
    expect(summariseToday([], window)).toEqual({ authorities: [], open: [] })
  })
})

describe('the inspection export, as a file', () => {
  const data: InspectionExport = {
    from: '2026-06-01',
    to: '2026-06-30',
    timeZone: 'Europe/Rome',
    rows: [
      {
        obligationId: 'a',
        adapterId: 'alloggiati',
        authority: 'questura',
        type: 'guest_registration',
        subject: 'BK-1',
        deadline: new Date('2026-06-10T20:00:00Z'),
        state: 'acknowledged',
        acknowledgedAt: new Date('2026-06-10T07:30:00Z'),
        evidence: {
          source: 'manual',
          hash: 'abc',
          recordedAt: new Date('2026-06-10T07:30:00Z'),
          receipt: { protocol: '12345', filedOn: '2026-06-10' },
          purgedAt: null,
        },
        attachment: { sha256: 'f1', contentType: 'application/pdf', deletedAt: null },
      },
      {
        obligationId: 'b',
        adapterId: 'webtur-fvg',
        authority: 'regione-fvg',
        type: 'istat_movement',
        subject: '2026-06-09',
        deadline: new Date('2026-06-10T21:59:59Z'),
        state: 'manual',
        acknowledgedAt: null,
        evidence: null,
        attachment: null,
      },
    ],
    counts: { total: 2, acknowledged: 1, open: 1, withoutEvidence: 0 },
  }

  it('has one line per obligation, in the property’s time, the receipt whole', () => {
    expect(inspectionCsv(data).split('\r\n')).toEqual([
      'autorita;adempimento;oggetto;scadenza;stato;ricevuto_il;fonte;riferimento;sha256_ricevuta;ricevuta_json;ricevuta_eliminata_il;sha256_file;file_eliminato_il',
      // The receipt's JSON has quotes, so the cell is quoted and they are doubled.
      'questura;guest_registration;BK-1;2026-06-10 22:00;acknowledged;2026-06-10 09:30;manual;12345;abc;"{""protocol"":""12345"",""filedOn"":""2026-06-10""}";;f1;',
      'regione-fvg;istat_movement;2026-06-09;2026-06-10 23:59;manual;;;;;;;;',
      '',
    ])
  })

  it('quotes a cell that holds the separator', () => {
    const odd = structuredClone(data)
    odd.rows = [{ ...data.rows[0]!, subject: 'A;B' }]
    expect(inspectionCsv(odd).split('\r\n')[1]).toMatch(/^questura;guest_registration;"A;B";/)
  })
})
