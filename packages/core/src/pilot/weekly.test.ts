import { describe, expect, it } from 'vitest'
import {
  assessTargets,
  countFilings,
  lastWeekStart,
  weekStartOf,
  weeklyReportText,
  type WeeklyPilotReport,
} from './weekly'

/** WP1.7: the weekly pilot report's arithmetic, targets and text. */
describe('the week', () => {
  it('starts on Monday', () => {
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28') // Monday
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28') // Sunday
    expect(weekStartOf('2026-10-01')).toBe('2026-09-28')
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28') // across the year
  })

  it('reports last week, in the property’s own days', () => {
    // Monday 5 October, 00:30 in Rome, is still Sunday 4 October in UTC.
    expect(lastWeekStart(new Date('2026-10-04T22:30:00Z'), 'Europe/Rome')).toBe('2026-09-28')
    expect(lastWeekStart(new Date('2026-10-04T22:30:00Z'), 'UTC')).toBe('2026-09-21')
  })
})

describe('filings in the week', () => {
  const now = new Date('2026-10-05T08:00:00Z')
  const at = (iso: string) => new Date(iso)

  it('counts on time, late, missed, by hand and not yet due', () => {
    const counts = countFilings(
      [
        // On time through the channel.
        {
          authority: 'questura',
          state: 'acknowledged',
          deadline: at('2026-09-30T10:00:00Z'),
          stateChangedAt: at('2026-09-29T10:00:00Z'),
          evidenceSource: 'channel',
        },
        // On time by hand.
        {
          authority: 'questura',
          state: 'acknowledged',
          deadline: at('2026-10-01T10:00:00Z'),
          stateChangedAt: at('2026-10-01T09:00:00Z'),
          evidenceSource: 'manual',
        },
        // Late, by hand.
        {
          authority: 'questura',
          state: 'acknowledged',
          deadline: at('2026-10-02T10:00:00Z'),
          stateChangedAt: at('2026-10-02T11:00:00Z'),
          evidenceSource: 'manual',
        },
        // Missed: still with a person after the deadline.
        {
          authority: 'questura',
          state: 'manual',
          deadline: at('2026-10-03T10:00:00Z'),
          stateChangedAt: at('2026-10-03T07:00:00Z'),
          evidenceSource: null,
        },
        // With the authority before the deadline, answer awaited: on time.
        {
          authority: 'regione-fvg',
          state: 'submitted',
          deadline: at('2026-10-04T21:59:59Z'),
          stateChangedAt: at('2026-10-04T08:00:00Z'),
          evidenceSource: null,
        },
        // Deadline later today: not yet due.
        {
          authority: 'regione-fvg',
          state: 'pending',
          deadline: at('2026-10-05T21:59:59Z'),
          stateChangedAt: at('2026-10-05T01:00:00Z'),
          evidenceSource: null,
        },
      ],
      now,
    )
    expect(counts).toEqual([
      { authority: 'questura', due: 4, onTime: 2, late: 1, missed: 1, byHand: 2, notYetDue: 0 },
      { authority: 'regione-fvg', due: 1, onTime: 1, late: 0, missed: 0, byHand: 0, notYetDue: 1 },
    ])
  })
})

function report(
  over: Partial<WeeklyPilotReport['desk']> = {},
  weekStart = '2026-09-28',
): WeeklyPilotReport {
  return {
    propertyId: 'p',
    timeZone: 'Europe/Rome',
    weekStart,
    weekEnd: '2026-10-04',
    filings: [
      { authority: 'questura', due: 5, onTime: 5, late: 0, missed: 0, byHand: 1, notYetDue: 0 },
    ],
    desk: {
      threads: 10,
      turns: 14,
      unansweredTurns: 0,
      medianFirstResponseSeconds: 12,
      autoResolved: 8,
      autoResolutionRate: 0.8,
      escalations: 2,
      phoneAlerts: 1,
      interruptions: 3,
      costCents: 250,
      costPerThreadCents: 25,
      repliesChecked: 14,
      unsafeActions: 0,
      ...over,
    },
    notMeasured: ['escalationPrecision', 'csat'],
  }
}

describe('the targets (plan §5 and §6)', () => {
  it('are met by a good week, against a noisier first week', () => {
    const first = report({ interruptions: 8 }, '2026-09-07')
    expect(assessTargets(report(), first)).toEqual({
      missedFilings: 'met',
      autoResolutionRate: 'met',
      medianFirstResponseSeconds: 'met',
      unsafeActions: 'met',
      interruptionsVsFirstWeek: 'met',
    })
  })

  it('are missed where the week falls short, and say when there is nothing to judge', () => {
    const bad = report({
      autoResolutionRate: 0.5,
      medianFirstResponseSeconds: 45,
      unsafeActions: 1,
      interruptions: 6,
    })
    bad.filings[0]!.missed = 1
    expect(assessTargets(bad, report({ interruptions: 8 }, '2026-09-07'))).toEqual({
      missedFilings: 'missed',
      autoResolutionRate: 'missed',
      medianFirstResponseSeconds: 'missed',
      unsafeActions: 'missed',
      interruptionsVsFirstWeek: 'missed',
    })

    const empty = report({
      autoResolutionRate: null,
      medianFirstResponseSeconds: null,
      repliesChecked: 0,
    })
    empty.filings = []
    // The first week is its own baseline: nothing to compare.
    expect(assessTargets(empty, empty)).toEqual({
      missedFilings: 'no-data',
      autoResolutionRate: 'no-data',
      medianFirstResponseSeconds: 'no-data',
      unsafeActions: 'no-data',
      interruptionsVsFirstWeek: 'no-data',
    })
  })
})

describe('the text sent to the pilot', () => {
  it('carries counts only, in Italian by default', () => {
    const text = weeklyReportText(report())
    expect(text.split('\n')).toEqual([
      'Resoconto settimanale BookOne, dal 2026-09-28 al 2026-10-04',
      '',
      'Adempimenti',
      '- questura: 5 in scadenza, 5 in tempo, 0 in ritardo, 0 mancati, 1 inviati a mano',
      '',
      'Messaggi degli ospiti',
      '- Conversazioni: 10; turni: 14, senza risposta: 0',
      '- Tempo mediano della prima risposta: 12 s',
      '- Risolte senza una persona: 80%',
      '- Passate a una persona: 2; avvisi al telefono: 1',
      '- Costo del modello: 2,50 € (0,25 € per conversazione)',
      '- Risposte controllate: 14; azioni non sicure: 0',
      '',
      'Non misurati: precisione dei passaggi a una persona, soddisfazione degli ospiti.',
      '',
    ])
    expect(weeklyReportText(report(), 'en')).toMatch(
      /Model cost: €2\.50 \(€0\.25 per conversation\)/,
    )
  })
})
