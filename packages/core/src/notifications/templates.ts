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
  /**
   * Where the guest manages the booking (E1.4).
   *
   * Carried in the confirmation because that email is the only thing a guest
   * reliably keeps. A self-service cancellation with no link in it is a
   * self-service cancellation nobody finds, and they phone the hotel instead —
   * which is the chore the whole product exists to remove.
   */
  manageUrl?: string | null
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
    ...(facts.manageUrl ? [interpolate(t.manage, { url: facts.manageUrl }), ''] : []),
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

/**
 * The pre-arrival invitation (E2.1).
 *
 * Sent at T-48h, in the guest's own language. Three things it deliberately
 * does, in this order:
 *
 *   1. **Says what they get.** "Go straight to your room" is the reason to
 *      spend five minutes on a phone; "complete your registration" is a chore.
 *   2. **Says how long.** A guest who knows it is five minutes starts now. A
 *      guest who does not, starts at the desk.
 *   3. **Says why the property must ask.** Registering every guest is a legal
 *      obligation on the hotel, and a stranger asking for a passport photo
 *      without explaining that reads as phishing — which is exactly what it
 *      would look like if we left the sentence out.
 */
export interface PrecheckinInviteFacts {
  propertyName: string
  guestName: string
  arrivalDate: string
  checkinUrl: string
}

export function renderPrecheckinInvite(
  locale: string,
  facts: PrecheckinInviteFacts,
): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.precheckinInvite

  const arrival = formatDate(facts.arrivalDate, resolved)

  const lines = [
    interpolate(t.greeting, { guestName: facts.guestName }),
    '',
    interpolate(t.intro, { property: facts.propertyName, arrival }),
    '',
    t.what,
    '',
    interpolate(t.cta, { url: facts.checkinUrl }),
    '',
    t.why,
    '',
    t.signOff,
    interpolate(t.sender, { property: facts.propertyName }),
  ]

  return {
    subject: interpolate(t.subject, { property: facts.propertyName }),
    body: lines.join('\n'),
  }
}

/** Template keys. Kept here beside the renderers so a key and its body move together. */
export const WELCOME = 'stay.welcome'
export const REVIEW_REQUEST = 'stay.review-request'
export const INVOICE_REQUEST_ROUTED = 'stay.invoice-request'
export const ESCALATION_ALERT = 'stay.escalation-alert'

/**
 * The welcome, sent the moment arrival is confirmed (E3.1).
 *
 * Every optional field is genuinely optional, and this is the whole design of
 * the template: a property that has not recorded a wifi password gets a message
 * with no wifi line, not a message with a blank one and certainly not a
 * plausible guess. Binding rule 7 applies to a welcome exactly as it applies to
 * the concierge — a made-up door code is a guest locked out at midnight.
 *
 * The stay link is included because it is now the thread, the checkout and the
 * key information in one place. A guest who kept the email can get back to all
 * of it without an account.
 */
export interface WelcomeFacts {
  propertyName: string
  guestName: string
  roomName: string | null
  arrivalDate: string
  departureDate: string
  accessNote: string | null
  wifiName: string | null
  wifiPassword: string | null
  stayUrl: string | null
}

export function renderWelcome(locale: string, facts: WelcomeFacts): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.welcome

  const lines = [
    interpolate(t.greeting, { guestName: facts.guestName }),
    '',
    interpolate(t.intro, { property: facts.propertyName }),
    ...(facts.roomName ? ['', `${t.labels.room}: ${facts.roomName}`] : []),
    `${t.labels.departure}: ${formatDate(facts.departureDate, resolved)}`,
    ...(facts.accessNote ? ['', t.labels.access, facts.accessNote] : []),
    ...(facts.wifiName
      ? [
          '',
          `${t.labels.wifi}: ${facts.wifiName}`,
          ...(facts.wifiPassword ? [`${t.labels.wifiPassword}: ${facts.wifiPassword}`] : []),
        ]
      : []),
    ...(facts.stayUrl ? ['', interpolate(t.stayLink, { url: facts.stayUrl })] : []),
    '',
    t.help,
    '',
    t.signOff,
    interpolate(t.sender, { property: facts.propertyName }),
  ]

  return {
    subject: interpolate(t.subject, { property: facts.propertyName }),
    body: lines.join('\n'),
  }
}

/**
 * The review request, sent after departure is confirmed (E4.1).
 *
 * Deliberately *not* on the checkout screen. That is where the response rate
 * is, and it is also where the answer is least informative and where a request
 * sitting next to a payment step starts to look like an inducement. It goes
 * once, afterwards, and it is not conditional on anything the guest said —
 * asking only the happy ones is review-gating, which the EU rules on review
 * solicitation take a dim view of and which produces a rating nobody should
 * trust anyway.
 */
export interface ReviewRequestFacts {
  propertyName: string
  guestName: string
  reviewUrl: string
}

export function renderReviewRequest(locale: string, facts: ReviewRequestFacts): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.reviewRequest

  const lines = [
    interpolate(t.greeting, { guestName: facts.guestName }),
    '',
    interpolate(t.intro, { property: facts.propertyName }),
    '',
    interpolate(t.cta, { url: facts.reviewUrl }),
    '',
    t.signOff,
    interpolate(t.sender, { property: facts.propertyName }),
  ]

  return {
    subject: interpolate(t.subject, { property: facts.propertyName }),
    body: lines.join('\n'),
  }
}

/**
 * An invoice request, routed to the property (E4.1).
 *
 * Goes to the property, in the property's language, and it is the whole of our
 * involvement: they issue the document through their own certified chain. The
 * body carries the guest's words unaltered, because editing what somebody asked
 * for and then forwarding it as though they had asked for that is the failure
 * this path is arranged to avoid (D11, binding rule 6).
 */
export interface InvoiceRequestFacts {
  guestName: string
  reference: string
  billTo: string
  details: string | null
}

export function renderInvoiceRequest(locale: string, facts: InvoiceRequestFacts): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.invoiceRequest

  const lines = [
    t.intro,
    '',
    `${t.labels.guest}: ${facts.guestName}`,
    `${t.labels.reference}: ${facts.reference}`,
    `${t.labels.billTo}: ${facts.billTo}`,
    ...(facts.details ? ['', `${t.labels.details}:`, facts.details] : []),
    '',
    t.note,
  ]

  return {
    subject: interpolate(t.subject, { reference: facts.reference }),
    body: lines.join('\n'),
  }
}

/**
 * A guest has been waiting on a person for too long (E3.2 SLA alert).
 *
 * Goes to the property, not the guest. It states how long and links to the
 * thread; it does not restate the guest's question, because an owner who reads
 * the summary in an email answers the email instead of the guest.
 */
export interface EscalationAlertFacts {
  guestName: string
  reference: string
  minutesWaiting: number
  threadUrl: string
}

export function renderEscalationAlert(
  locale: string,
  facts: EscalationAlertFacts,
): RenderedMessage {
  const resolved: TemplateLocale = isTemplateLocale(locale) ? locale : 'en'
  const t = catalogues[resolved].notifications.escalationAlert

  const lines = [
    interpolate(t.intro, {
      guestName: facts.guestName,
      minutes: String(facts.minutesWaiting),
    }),
    '',
    `${t.labels.reference}: ${facts.reference}`,
    '',
    interpolate(t.cta, { url: facts.threadUrl }),
  ]

  return {
    subject: interpolate(t.subject, { guestName: facts.guestName }),
    body: lines.join('\n'),
  }
}
