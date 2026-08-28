import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatMoney,
  interpolate,
  renderBookingConfirmation,
  renderBookingRequest,
  type BookingConfirmationFacts,
} from '../templates'

/**
 * What a guest and a hotel actually receive.
 *
 * Worth testing because the failure mode is silent and reaches a real person:
 * a missing key renders as its own path, an unsubstituted placeholder renders
 * as `{guestName}`, and neither breaks a build. In four languages, at least one
 * of them is a language nobody on the team reads.
 */

const facts: BookingConfirmationFacts = {
  propertyName: 'Hotel Sonja',
  guestName: 'Rosa Weber',
  reference: 'BO-7QK2M9',
  arrivalDate: '2026-09-02',
  departureDate: '2026-09-05',
  roomName: 'Familienzimmer',
  adults: 2,
  children: 1,
  totalCents: 35_000,
  currency: 'EUR',
  touristTaxPhrase: '2,00 € × 2 × 3 = 12,00 €',
}

const locales = ['it', 'de', 'en', 'sl'] as const

describe('renderBookingConfirmation', () => {
  it.each(locales)('renders in %s with no placeholder left standing', (locale) => {
    const message = renderBookingConfirmation(locale, facts)

    // An unsubstituted `{name}` is the visible half of the failure; the other
    // half is a key path rendered as text where a sentence should be.
    expect(message.subject).not.toMatch(/[{}]/)
    expect(message.body).not.toMatch(/[{}]/)
    expect(message.body).not.toMatch(/notifications\.booking/)
  })

  it.each(locales)('states the reference and the total in %s', (locale) => {
    const message = renderBookingConfirmation(locale, facts)

    // The reference is the one thing on this message the guest cannot look up
    // again, and the total is the one they will be held to.
    expect(message.subject).toContain('BO-7QK2M9')
    expect(message.body).toContain('BO-7QK2M9')
    expect(message.body).toContain(formatMoney(35_000, 'EUR', locale))
  })

  it('omits the children line rather than printing a zero', () => {
    const message = renderBookingConfirmation('de', { ...facts, children: 0 })

    expect(message.body).not.toMatch(/Kinder/)
    expect(message.body).toMatch(/Erwachsene: 2/)
  })

  it('omits the tourist-tax sentence when the property charges none', () => {
    const message = renderBookingConfirmation('en', { ...facts, touristTaxPhrase: null })

    expect(message.body).not.toMatch(/[Tt]ourist tax/)
  })

  it('falls back to English for a locale it does not carry', () => {
    // Never throws on an unexpected locale: the alternative is a confirmation
    // that fails to send because somebody stored `fr` on a guest row.
    const message = renderBookingConfirmation('fr', facts)

    expect(message.body).toContain('Booking reference')
  })
})

describe('renderBookingRequest', () => {
  it('goes to the property in the property’s language, carrying the guest’s words', () => {
    const message = renderBookingRequest('it', {
      guestName: 'Marko Novak',
      guestEmail: 'marko.novak@example.test',
      guestPhone: null,
      arrivalDate: '2026-09-02',
      departureDate: '2026-09-04',
      adults: 2,
      children: 0,
      message: 'Prosim za ponudbo za dve nočitvi.',
    })

    expect(message.subject).toMatch(/Richiesta/)
    // The guest's own message is passed through untouched — it is theirs, and
    // a hotel answering it needs the words they actually wrote.
    expect(message.body).toContain('Prosim za ponudbo za dve nočitvi.')
    expect(message.body).toContain('marko.novak@example.test')
    expect(message.body).not.toMatch(/[{}]/)
  })
})

describe('formatDate', () => {
  it('does not shift a calendar date into the reader’s timezone', () => {
    // Arrival and departure are hotel-local calendar dates, not instants. A
    // local-time render moves an arrival to the day before for anyone west of
    // the property — and the guest who notices is already travelling.
    //
    // Asserted against both renderings of the same instant rather than against
    // a literal string, because the literal would be asserting a locale's date
    // order and not the thing that matters.
    const instant = new Date('2026-01-01T00:00:00Z')
    const inUtc = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' })
    const inNewYork = new Intl.DateTimeFormat('en', {
      dateStyle: 'long',
      timeZone: 'America/New_York',
    })

    expect(formatDate('2026-01-01', 'en')).toBe(inUtc.format(instant))
    // The negative control: the same instant west of the property is the 31st.
    expect(formatDate('2026-01-01', 'en')).not.toBe(inNewYork.format(instant))
  })
})

describe('interpolate', () => {
  it('leaves an unknown placeholder visible rather than blanking it', () => {
    // "Hello ," has lost the fact silently. "Hello {guestName}," is at least
    // obviously broken to whoever reads the first test message.
    expect(interpolate('Hello {guestName},', {})).toBe('Hello {guestName},')
  })

  it('substitutes every occurrence', () => {
    expect(interpolate('{a} and {a} and {b}', { a: 'x', b: 'y' })).toBe('x and x and y')
  })
})
