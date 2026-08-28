import de from '@bookone/i18n/messages/de.json'
import en from '@bookone/i18n/messages/en.json'
import it from '@bookone/i18n/messages/it.json'
import sl from '@bookone/i18n/messages/sl.json'

/**
 * Notification templates (E1.2).
 *
 * Rendered from the same catalogues the web app uses, so a phrase exists once
 * and a locale that is missing here fails the parity test there.
 *
 * ## No plurals, on purpose
 *
 * Every value below is a label and a value — "Adults: 2", not "2 adults". That
 * is what a confirmation email actually looks like, and it also sidesteps
 * plural agreement in four languages, one of which (Slovenian) has four plural
 * categories. The alternative was an ICU formatter in a package that is
 * deliberately framework-free, to solve a problem the layout does not have.
 *
 * ## Facts only
 *
 * Every field this renders is passed in already resolved from a row. Nothing
 * here computes a price, a date or an availability, and nothing here says
 * anything the caller did not hand it (binding rule 7).
 */

const catalogues = { de, en, it, sl } as const

export type TemplateLocale = keyof typeof catalogues

export function isTemplateLocale(value: string): value is TemplateLocale {
  return value in catalogues
}

export interface RenderedMessage {
  subject: string
  body: string
}

/** The facts a confirmation states. All of them come from the reservation. */
export interface BookingConfirmationFacts {
  propertyName: string
  guestName: string
  reference: string
  /** `YYYY-MM-DD`; formatted for the locale here. */
  arrivalDate: string
  departureDate: string
  roomName: string
  adults: number
  children: number
  totalCents: number
  currency: string
  /** Already-composed tourist-tax sentence, or null when the property has none. */
  touristTaxPhrase: string | null
}

export function renderBookingConfirmation(
  locale: string,
  facts: BookingConfirmationFacts,
): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.bookingConfirmation

  const money = formatMoney(facts.totalCents, facts.currency, resolved)

  const lines = [
    interpolate(t.greeting, { guestName: facts.guestName }),
    '',
    interpolate(t.intro, { property: facts.propertyName }),
    '',
    `${t.labels.reference}: ${facts.reference}`,
    `${t.labels.arrival}: ${formatDate(facts.arrivalDate, resolved)}`,
    `${t.labels.departure}: ${formatDate(facts.departureDate, resolved)}`,
    `${t.labels.room}: ${facts.roomName}`,
    `${t.labels.adults}: ${facts.adults}`,
    // Omitted rather than shown as zero. "Children: 0" reads as a question the
    // hotel is asking, and a line that says nothing is a line worth dropping.
    ...(facts.children > 0 ? [`${t.labels.children}: ${facts.children}`] : []),
    `${t.labels.total}: ${money}`,
    '',
    ...(facts.touristTaxPhrase
      ? [interpolate(t.touristTax, { touristTax: facts.touristTaxPhrase }), '']
      : []),
    t.payment,
    '',
    t.help,
    '',
    t.signOff,
    interpolate(t.sender, { property: facts.propertyName }),
  ]

  return {
    subject: interpolate(t.subject, {
      property: facts.propertyName,
      reference: facts.reference,
    }),
    body: lines.join('\n'),
  }
}

/**
 * `{name}` substitution and nothing else.
 *
 * A placeholder with no value is left standing rather than replaced with an
 * empty string: an email reading "Hello ," has lost the fact silently, and
 * "Hello {guestName}," is at least visibly broken to whoever tests it.
 */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

export function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}

export function formatDate(date: string, locale: string): string {
  // Parsed as UTC and formatted in UTC. These are hotel-local calendar dates,
  // not instants (03 §2) — rendering them in the reader's zone would move an
  // arrival to the day before for anyone west of the property.
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

/**
 * The facts a booking request carries to the property.
 *
 * Note who reads this one: the hotel, not the guest. It goes out in the
 * property's default locale, and its job is to let a human answer an email in
 * under a minute — which is why the guest's own address is in the body and not
 * only in a reply-to header.
 */
export interface BookingRequestFacts {
  guestName: string
  guestEmail: string
  guestPhone: string | null
  arrivalDate: string
  departureDate: string
  adults: number
  children: number
  message: string | null
}

export function renderBookingRequest(locale: string, facts: BookingRequestFacts): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.bookingRequest

  const arrival = formatDate(facts.arrivalDate, resolved)
  const departure = formatDate(facts.departureDate, resolved)

  const lines = [
    t.intro,
    '',
    `${t.labels.guest}: ${facts.guestName}`,
    `${t.labels.email}: ${facts.guestEmail}`,
    ...(facts.guestPhone ? [`${t.labels.phone}: ${facts.guestPhone}`] : []),
    `${t.labels.arrival}: ${arrival}`,
    `${t.labels.departure}: ${departure}`,
    `${t.labels.adults}: ${facts.adults}`,
    ...(facts.children > 0 ? [`${t.labels.children}: ${facts.children}`] : []),
    ...(facts.message ? ['', `${t.labels.message}:`, facts.message] : []),
    '',
    interpolate(t.action, { email: facts.guestEmail }),
  ]

  return {
    subject: interpolate(t.subject, { arrival, departure }),
    body: lines.join('\n'),
  }
}
