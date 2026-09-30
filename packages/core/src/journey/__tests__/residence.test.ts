import { describe, expect, it } from 'vitest'
import { originOf } from '../../compliance/istat'
import { residenceFields } from '../residence'

/** Residence from the pre-arrival form (ADR-045). */
describe('residenceFields', () => {
  it('keeps a country and, for Italy, the province, upper-cased', () => {
    expect(residenceFields('it', ' ts ')).toEqual({
      residenceCountry: 'IT',
      residenceProvince: 'TS',
    })
    expect(residenceFields('de')).toEqual({ residenceCountry: 'DE' })
  })

  it('drops a province outside Italy', () => {
    expect(residenceFields('AT', 'W')).toEqual({ residenceCountry: 'AT' })
    expect(residenceFields('SI', 'LJ')).toEqual({ residenceCountry: 'SI' })
  })

  it('stores nothing that is not a two-letter code', () => {
    expect(residenceFields('')).toEqual({})
    expect(residenceFields(undefined, 'TS')).toEqual({})
    expect(residenceFields('Italia', 'TS')).toEqual({})
    expect(residenceFields('IT', 'Trieste')).toEqual({ residenceCountry: 'IT' })
  })

  it('is what the ISTAT return counts, ahead of citizenship', () => {
    // A German citizen living in Trieste counts for Trieste, not Germany.
    const guest = { ...residenceFields('IT', 'TS'), citizenship: 'DE' }
    expect(originOf(guest)).toEqual({ origin: 'IT-TS', byCitizenship: false })
    // Without a residence the return falls back, and says so.
    expect(originOf({ ...residenceFields('Germany'), citizenship: 'DE' })).toEqual({
      origin: 'DE',
      byCitizenship: true,
    })
  })
})
