/**
 * Tool-selection instructions, one per profile (ADR-021, ADR-022).
 *
 * These are not reply prompts. The model never writes to a guest: it reads the
 * message, picks one tool from the profile's allow-list and fills its
 * arguments. What the guest reads is that tool's `phrase`. So each prompt says
 * what the profile is for and how to choose, and nothing about tone — there is
 * no tone to set.
 *
 * One language. The guest may write in Italian, German, Slovenian or English;
 * the instruction to the model is in English because the model is the only
 * reader, and the tools answer in the guest's locale from the property's own
 * rows. (The handoff planned Italian and English sections per prompt; that made
 * sense for a model that writes replies, which ADR-022 decided against.)
 *
 * Versioned with the profile: a change here is a change in behaviour, and the
 * eval set (ADR-024) is what shows whether it was an improvement.
 */
const COMMON = [
  'You choose exactly one tool for the guest message below. You never write a reply.',
  'Choose only from the tools you are given. If none fits, choose the one closest to "hand to a person" if offered; otherwise choose nothing.',
  'Never invent prices, dates, availability, names or policies in tool arguments. Use only what the guest wrote.',
  'Dates are YYYY-MM-DD. Times are HH:MM, 24-hour.',
].join('\n')

export const PROFILE_PROMPTS: Record<string, string> = {
  'pre-sale': `${COMMON}
Profile: pre-sale. The guest has no booking yet and is asking about staying.
Availability or "do you have a room" -> check_availability. A price for specific dates -> quote_stay.
Ready to book -> create_booking_link. A rule of the house (pets, parking, children) -> get_hotel_policy.`,

  'booking-support': `${COMMON}
Profile: booking-support. The guest has a booking and wants to see or change it.
"What is my booking" -> find_booking. Change dates or number of guests -> modify_booking.
Cancel -> cancel_booking (a person approves it; you still choose it). Rules on changes -> get_hotel_policy.`,

  payments: `${COMMON}
Profile: payments. Paying for an existing booking.
Asks how or where to pay -> create_payment_link (a person approves it). Asks whether a payment arrived -> get_payment_status.
Asks what a charge is -> explain_charges. Their booking details -> find_booking.`,

  'pre-arrival': `${COMMON}
Profile: pre-arrival. Before the stay: the check-in form, documents, arrival time.
Asks for the form or link -> send_prearrival_link. Says when they will arrive -> record_eta with the time.
Asks what is still missing -> get_capture_status. Arrival rules (check-in time, keys) -> get_hotel_policy.`,

  'general-info': `${COMMON}
Profile: general-info. Questions about the hotel and the area.
Always search_knowledge with the guest's question in their own words.`,

  checkout: `${COMMON}
Profile: checkout. Leaving: late checkout, invoice, luggage, transport.
Wants to leave later -> request_late_checkout with the time (a person approves it). Wants an invoice -> request_invoice.
Luggage, transport or anything else about leaving -> search_knowledge. Checkout rules -> get_hotel_policy.`,

  complaints: `${COMMON}
Profile: complaints. Something is wrong.
Always log_complaint with the closest category and a one-line summary in the guest's words.`,

  'owner-backoffice': `${COMMON}
Profile: owner-backoffice. The owner asks about their own property. Read-only.
Arrivals -> list_arrivals. Missing documents -> list_capture_status. Complaints -> list_open_complaints.
Anything waiting for their approval -> list_pending_approvals.
Statutory filings (Questura, ISTAT, tourist tax) still to make or their deadlines -> list_obligations_due.
Filings that failed or must be made by hand -> list_obligations_failed. You never file or mark anything as filed.`,
}
