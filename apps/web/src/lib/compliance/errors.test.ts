import { describe, expect, it } from 'vitest'
import { describeObligationError, obligationErrorLines } from './errors'

/** A filing's `last_error`, read back into the desk's language. */
describe('describeObligationError', () => {
  it('recognises the lifecycle’s own sentences', () => {
    expect(describeObligationError('The deadline is close: file by hand.')).toEqual([
      { key: 'deadlineClose' },
    ])
    expect(describeObligationError('The stay no longer exists.')).toEqual([{ key: 'stayGone' }])
    expect(describeObligationError('No channel to file this with yet: file it by hand.')).toEqual([
      { key: 'noChannel' },
    ])
  })

  it('keeps the registry’s refusal in its own words, guest by guest', () => {
    expect(
      describeObligationError(
        'the registry refused the filing — Guest 1: Comune di nascita non valido (403015); Guest 2: Documento scaduto',
      ),
    ).toEqual([
      {
        key: 'refused',
        lines: [
          { guest: '1', said: 'Comune di nascita non valido (403015)' },
          { guest: '2', said: 'Documento scaduto' },
        ],
      },
    ])
  })

  it('reads the channel’s failures', () => {
    expect(describeObligationError('credentials refused: Utente bloccato')).toEqual([
      { key: 'credentialsRefused', values: { said: 'Utente bloccato' } },
    ])
    expect(describeObligationError('Send: HTTP 503')).toEqual([
      { key: 'channelHttp', values: { status: '503' } },
    ])
    expect(
      describeObligationError(
        'no answer after sending: the filing may have gone through. Check the day’s receipt on the portal before filing by hand.',
      ),
    ).toEqual([{ key: 'ambiguous' }])
    expect(describeObligationError('unreadable answer: bad XML')).toEqual([{ key: 'unreadable' }])
  })

  it('splits joined messages, and frames anything unknown as the channel’s words', () => {
    expect(
      describeObligationError(
        "Guest 2: birthPlace — missing · Stay BO-1: a guest's residence or citizenship is not recorded · Qualcosa di nuovo",
      ),
    ).toEqual([
      { key: 'guestIssue', values: { guest: '2', field: 'birthPlace', problem: 'missing' } },
      { key: 'originMissing', values: { reference: 'BO-1' } },
      { key: 'channelSaid', values: { said: 'Qualcosa di nuovo' } },
    ])
    expect(describeObligationError(null)).toEqual([])
  })

  it('turns into sentences through the catalogue', () => {
    const t = (key: string, values?: Record<string, string>) =>
      values ? `${key}(${Object.values(values).join('|')})` : key
    expect(
      obligationErrorLines('the registry refused the filing — Guest 1: Documento scaduto', t),
    ).toEqual(['refused', 'refusedLine(1|Documento scaduto)'])
  })
})
