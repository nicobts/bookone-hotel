import { describe, expect, it } from 'vitest'
import { chooseOwnerTool, phoneKey } from './owner'

describe("the owner's assistant — routing by rules (WP0.5)", () => {
  it.each([
    ['Quanti arrivi domani?', 'list_arrivals'],
    ['How many arrivals tomorrow?', 'list_arrivals'],
    ['Wie viele Anreisen morgen?', 'list_arrivals'],
    ['Chi non ha ancora mandato i documenti?', 'list_capture_status'],
    ['Ci sono reclami aperti?', 'list_open_complaints'],
    ['Any open complaints?', 'list_open_complaints'],
    ['Cosa devo approvare?', 'list_pending_approvals'],
  ])('%j → %s', async (message, tool) => {
    expect(await chooseOwnerTool(message, null)).toBe(tool)
  })

  it('answers nothing it has no list for — it never writes, and never guesses', async () => {
    expect(await chooseOwnerTool('Cambia il prezzo della doppia a 200 euro', null)).toBeNull()
  })
})

describe('phone numbers', () => {
  it('compares on digits, with or without the international prefix style', () => {
    expect(phoneKey('+39 040 0000001')).toBe(phoneKey('0039 040-000-0001'))
    expect(phoneKey('+39 040 0000001')).not.toBe(phoneKey('+39 040 0000002'))
  })
})
