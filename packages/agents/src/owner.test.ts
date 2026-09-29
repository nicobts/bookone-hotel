import { describe, expect, it } from 'vitest'
import { toE164 } from '@bookone/core/contacts'
import { chooseOwnerTool } from './owner'

describe("the owner's assistant — routing by rules (WP0.5)", () => {
  it.each([
    ['Quanti arrivi domani?', 'list_arrivals'],
    ['How many arrivals tomorrow?', 'list_arrivals'],
    ['Wie viele Anreisen morgen?', 'list_arrivals'],
    ['Chi non ha ancora mandato i documenti?', 'list_capture_status'],
    ['Ci sono reclami aperti?', 'list_open_complaints'],
    ['Any open complaints?', 'list_open_complaints'],
    ['Cosa devo approvare?', 'list_pending_approvals'],
    ['Ci sono comunicazioni alla Questura in scadenza?', 'list_obligations_due'],
    ['Which filings are due today?', 'list_obligations_due'],
    ['Welche Meldungen sind noch offen?', 'list_obligations_due'],
    ['Quali schedine sono fallite?', 'list_obligations_failed'],
    ['What do I have to file by hand?', 'list_obligations_failed'],
    ['Katere prijave so spodletele?', 'list_obligations_failed'],
    ['Which filings are manual?', 'list_obligations_failed'],
    ['Quali comunicazioni vanno fatte manualmente?', 'list_obligations_failed'],
    ['Welche Meldungen muss ich manuell machen?', 'list_obligations_failed'],
  ])('%j → %s', async (message, tool) => {
    expect(await chooseOwnerTool(message, null)).toBe(tool)
  })

  it('answers nothing it has no list for — it never writes, and never guesses', async () => {
    expect(await chooseOwnerTool('Cambia il prezzo della doppia a 200 euro', null)).toBeNull()
  })
})

describe('phone numbers', () => {
  it('compares as E.164, with either international prefix style', () => {
    expect(toE164('+39 040 0000001')).toBe(toE164('0039 040-000-0001'))
    expect(toE164('+39 040 0000001')).not.toBe(toE164('+39 040 0000002'))
  })

  it('refuses a number without a country code rather than guessing one', () => {
    expect(toE164('040 0000001')).toBeNull()
    expect(toE164('+39')).toBeNull()
  })
})
