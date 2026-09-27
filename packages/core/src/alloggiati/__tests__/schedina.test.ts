import { describe, expect, it } from 'vitest'
import { schedinaPreview } from '../schedina'
import type { GuestDetails } from '../record'

/** The schedina preview is the filing, cut back into fields (WP0.4). */
const stay = { arrivalDate: '2026-10-01', departureDate: '2026-10-04' }

const anna: GuestDetails = {
  surname: 'Eriksson',
  givenName: 'Anna Maria',
  sex: 'f',
  birthDate: '1974-08-12',
  birthCountryCode: 'SE',
  citizenshipCode: 'SE',
  documentType: 'passport',
  documentNumber: 'L898902C3',
  documentIssuerCode: 'SE',
}

const field = (preview: ReturnType<typeof schedinaPreview>, guest: number, name: string) =>
  preview.guests[guest]?.fields.find((f) => f.name === name)?.value

describe('schedinaPreview', () => {
  it('shows a ready party exactly as the record would be filed', () => {
    const preview = schedinaPreview([anna], stay)

    expect(preview.ready).toBe(true)
    expect(field(preview, 0, 'guestType')).toBe('16') // a single guest
    expect(field(preview, 0, 'nights')).toBe('03') // zero-padded, as filed
    expect(field(preview, 0, 'sex')).toBe('2') // the registry's code for female
    expect(field(preview, 0, 'surname')).toBe('ERIKSSON')
    expect(field(preview, 0, 'documentType')).toBe('PASOR')
    expect(field(preview, 0, 'documentNumber')).toBe('L898902C3')
  })

  it('marks the head of a family and its members as the registry distinguishes them', () => {
    const preview = schedinaPreview(
      [anna, { ...anna, givenName: 'Erik', sex: 'm', birthDate: '2012-01-01' }],
      stay,
    )

    expect(field(preview, 0, 'guestType')).toBe('17')
    expect(field(preview, 1, 'guestType')).toBe('19')
  })

  it('is not ready while a required field is missing, and says which', () => {
    const { birthDate: _missing, ...partial } = anna
    const preview = schedinaPreview([partial], stay)

    expect(preview.ready).toBe(false)
    expect(preview.issues.map((issue) => issue.field)).toContain('birthDate')
    expect(field(preview, 0, 'surname')).toBe('Eriksson')
  })

  it('is not ready with nobody in the party', () => {
    expect(schedinaPreview([], stay).ready).toBe(false)
  })
})
