import de from '@bookone/i18n/messages/de.json'
import en from '@bookone/i18n/messages/en.json'
import it from '@bookone/i18n/messages/it.json'
import sl from '@bookone/i18n/messages/sl.json'
import {
  formatDate,
  interpolate,
  isTemplateLocale,
  type TemplateLocale,
} from '../notifications/templates'

/**
 * The sentences the concierge is allowed to say (ADR-009, binding rule 7).
 *
 * Every tool returns a `phrase` and the reply *is* that phrase, verbatim. This
 * file is where a phrase is composed, and it composes only from values handed
 * to it — a date that came out of a row, a reference that came out of a row, an
 * answer the property wrote. Nothing here generates a fact.
 *
 * ## Why the phrases live in the message catalogue
 *
 * Same reason the notification templates do: a sentence exists once, in four
 * languages, and the locale parity test fails when one is missing. It also
 * means an owner's product speaks the same way in an email and in a chat, which
 * is what a guest expects from a business rather than from two systems.
 *
 * ## Why there is no "compose a friendly sentence" helper
 *
 * Because that is the door rule 7 exists to keep shut. The moment a phrase is
 * assembled from a template plus a model's words, the tool-boundary audit stops
 * being able to tell provenance — and the audit is the only thing standing
 * between a design principle and a hope.
 */

const catalogues = { de, en, it, sl } as const

function resolve(locale: string): TemplateLocale {
  return isTemplateLocale(locale) ? locale : 'en'
}

export interface ReservationPhraseFacts {
  reference: string
  arrivalDate: string
  departureDate: string
  roomName: string | null
  status: string
}

/** What the guest's own booking says. Every value read from the reservation row. */
export function reservationPhrase(locale: string, facts: ReservationPhraseFacts): string {
  const resolved = resolve(locale)
  const t = catalogues[resolved].concierge

  const base = interpolate(t.reservation, {
    reference: facts.reference,
    arrival: formatDate(facts.arrivalDate, resolved),
    departure: formatDate(facts.departureDate, resolved),
  })

  // The room is appended rather than interleaved, because a property that has
  // not named its room types would otherwise produce a sentence with a gap in
  // the middle of it.
  return facts.roomName
    ? `${base} ${interpolate(t.reservationRoom, { room: facts.roomName })}`
    : base
}

/**
 * A request has been written down (E3.4).
 *
 * Note what it does **not** say: that anything has been done. "I have asked
 * housekeeping" is a claim about a person the software has not spoken to. "This
 * is recorded and the property can see it" is true, and it is the sentence a
 * guest can act on — because if nothing happens, they know to ask again.
 */
export function taskRecordedPhrase(locale: string): string {
  return catalogues[resolve(locale)].concierge.taskRecorded
}

/** Handing over to a person, said to the guest. */
export function escalatedPhrase(locale: string): string {
  return catalogues[resolve(locale)].concierge.escalated
}

/** The same, when nobody is on shift — see design-notes/stay-messaging.md §4D. */
export function escalatedOutOfHoursPhrase(locale: string, hours: string): string {
  return interpolate(catalogues[resolve(locale)].concierge.escalatedOutOfHours, { hours })
}

/**
 * The transparency disclosure, shown once at the top of a thread.
 *
 * Once, not on every message: a disclaimer on each line is noise a guest stops
 * reading, which defeats the purpose. This is an EU AI Act transparency
 * obligation for interaction with an AI system, and it is also how a handover to
 * a person later does not feel like a deception.
 */
export function disclosurePhrase(locale: string): string {
  return catalogues[resolve(locale)].concierge.disclosure
}
