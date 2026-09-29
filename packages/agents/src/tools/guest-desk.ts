import { searchAvailability } from '@bookone/core/booking'
import {
  alertEscalation,
  complaintCategoryLabel,
  createStayTask,
  deskPhrase,
  filingLabel,
  getPropertySlug,
  getStayFacts,
  isComplaintCategory,
  listArrivalsOn,
  listCaptureOutstanding,
  listOpenComplaints,
  listPendingApprovals,
  localisedName,
  logComplaint,
  markComplaintOwnerAlerted,
  obligationStateLabel,
  type StayFacts,
} from '@bookone/core/concierge'
import { formatDeadline, listObligationsForOwner } from '@bookone/core/compliance'
import { agentActor } from '@bookone/core/events'
import { sendPrecheckinInvite, setExpectedArrival } from '@bookone/core/journey'
import { formatDate, formatMoney } from '@bookone/core/notifications'
import { isEntitled } from '@bookone/core/onboarding'
import { requestInvoice } from '@bookone/core/stay'
import { getPropertyInfoTool, getReservationTool, searchKbTool } from './concierge'
import type { Tool, ToolContext, ToolResult } from './index'

/**
 * The Guest Desk profiles' tools (ADR-021, WP0.2–0.3).
 *
 * Every tool answers with a `phrase` built from rows (ADR-022, binding rule 7):
 * dates, prices and names come from the booking, the rate cache or the
 * property, never from the model that chose the tool. A tool that cannot say
 * something true fails, and the orchestrator hands the turn to a person.
 *
 * `handoff: true` on a result means "say this, then hand to a person": the
 * action was recorded but a person must confirm it (a date change, a complaint).
 *
 * Two tools still refuse: `cancel_booking` and `create_payment_link`. Both are
 * approval-held, so they run from the approval step (WP0.6), and both need the
 * payment adapter — which, while it is the in-memory mock, lives in `apps/api`
 * rather than here (ADR-034). They are wired when either of those changes.
 */

const AG01 = agentActor('AG-01')

const QUESTION = {
  type: 'object',
  properties: { question: { type: 'string', description: "The guest's question, in their words" } },
  required: ['question'],
  additionalProperties: false,
} as const

const NONE = { type: 'object', properties: {}, additionalProperties: false } as const

const TOPIC = {
  type: 'object',
  properties: {
    topic: { type: 'string', description: 'The policy topic, e.g. "checkout", "pets", "parking"' },
  },
  required: ['topic'],
  additionalProperties: false,
} as const

const DATES = {
  type: 'object',
  properties: {
    arrival: { type: 'string', description: 'YYYY-MM-DD' },
    departure: { type: 'string', description: 'YYYY-MM-DD' },
    adults: { type: 'integer', minimum: 1 },
    children: { type: 'integer', minimum: 0 },
  },
  required: ['arrival', 'departure', 'adults'],
  additionalProperties: false,
} as const

const TIME = {
  type: 'object',
  properties: { time: { type: 'string', description: 'HH:MM, 24-hour' } },
  required: ['time'],
  additionalProperties: false,
} as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function fail(error: string): ToolResult {
  return { ok: false, output: { error } }
}

function locale(context: ToolContext): string {
  return context.locale ?? 'en'
}

/** Dates and party from a model's arguments, validated — never trusted as given. */
function readDates(
  input: Record<string, unknown>,
): { arrival: string; departure: string; adults: number; children: number } | string {
  const arrival = typeof input.arrival === 'string' ? input.arrival : ''
  const departure = typeof input.departure === 'string' ? input.departure : ''
  if (!DATE_RE.test(arrival) || !DATE_RE.test(departure)) return 'dates must be YYYY-MM-DD'
  if (departure <= arrival) return 'departure must be after arrival'

  const adults = Number.isInteger(input.adults) ? (input.adults as number) : 0
  const children = Number.isInteger(input.children) ? (input.children as number) : 0
  if (adults < 1 || adults > 8 || children < 0 || children > 8) return 'party size out of range'

  return { arrival, departure, adults, children }
}

async function stay(context: ToolContext): Promise<StayFacts | string> {
  if (!context.reservationId) return 'no reservation in context'
  const facts = await getStayFacts(context.propertyId, context.reservationId)
  return facts ?? 'reservation not found'
}

function alias(name: string, description: string, of: Tool, input: Record<string, unknown>): Tool {
  return { ...of, name, description, input, reversible: false }
}

function notYet(
  name: string,
  description: string,
  input: Record<string, unknown>,
  reversible: boolean,
): Tool {
  return {
    name,
    description,
    input,
    reversible,
    run: async () => ({
      ok: false,
      output: { error: `${name} runs from the approval step (WP0.6)`, unavailable: true },
    }),
  }
}

/** Availability for dates, as a phrase listing each free room and its total. */
const checkAvailabilityTool: Tool = {
  name: 'check_availability',
  description: 'Check which rooms are free for given dates, with the total for the stay',
  input: DATES,
  reversible: false,
  run: async (context, input) => {
    const dates = readDates(input)
    if (typeof dates === 'string') return fail(dates)

    const outcome = await searchAvailability({ propertyId: context.propertyId, ...dates })
    // A stale cache is not "nothing free" — it is "we cannot say". A person answers.
    if (outcome.status !== 'ok') return fail('availability is not current')

    const lang = locale(context)
    const when = {
      arrival: formatDate(dates.arrival, lang),
      departure: formatDate(dates.departure, lang),
    }

    if (outcome.options.length === 0) {
      return {
        ok: true,
        output: { found: true, rooms: [], phrase: deskPhrase(lang, 'availabilityNone', when) },
      }
    }

    const rooms = outcome.options.map(
      (option) =>
        `${localisedName(option.nameI18n, lang) ?? option.code} (${formatMoney(option.quote.totalCents, option.quote.currency, lang)})`,
    )

    return {
      ok: true,
      output: {
        found: true,
        rooms: outcome.options.map((option) => ({
          code: option.code,
          totalCents: option.quote.totalCents,
        })),
        phrase: deskPhrase(lang, 'availability', { ...when, rooms: rooms.join(', ') }),
      },
    }
  },
}

/** A link to the booking engine for these dates — only where the property has one. */
const createBookingLinkTool: Tool = {
  name: 'create_booking_link',
  description: 'Create a link to book the stay on the property booking page',
  input: DATES,
  reversible: false,
  run: async (context, input) => {
    const dates = readDates(input)
    if (typeof dates === 'string') return fail(dates)
    if (!context.appUrl) return fail('no public url configured')
    if (!(await isEntitled(context.propertyId, 'booking_engine'))) {
      return fail('this property does not take bookings online')
    }

    const slug = await getPropertySlug(context.propertyId)
    if (!slug) return fail('property not found')

    const query = new URLSearchParams({
      arrival: dates.arrival,
      departure: dates.departure,
      adults: String(dates.adults),
      children: String(dates.children),
    })
    const url = `${context.appUrl.replace(/\/$/, '')}/${locale(context)}/book/${slug}?${query}`

    return {
      ok: true,
      output: { url, phrase: deskPhrase(locale(context), 'bookingLink', { url }) },
    }
  },
}

/**
 * A date change: checked against availability, then recorded as a task for a
 * person to confirm. Not written to the booking directly — the PMS or the
 * property confirms changes, and a change that moves money needs a person.
 */
const modifyBookingTool: Tool = {
  name: 'modify_booking',
  description: "Ask to change this guest's own booking dates or party size",
  input: DATES,
  reversible: true,
  write: true,
  run: async (context, input) => {
    const dates = readDates(input)
    if (typeof dates === 'string') return fail(dates)
    const facts = await stay(context)
    if (typeof facts === 'string') return fail(facts)

    const outcome = await searchAvailability({ propertyId: context.propertyId, ...dates })
    const free =
      outcome.status === 'ok' &&
      outcome.options.some((option) => option.code === facts.roomTypeCode)

    const lang = locale(context)
    const taskId = await createStayTask({
      propertyId: context.propertyId,
      reservationId: facts.reservationId,
      threadId: context.threadId ?? null,
      summary:
        `Change request: ${facts.arrivalDate}–${facts.departureDate} → ${dates.arrival}–${dates.departure}, ` +
        `${dates.adults} adults, ${dates.children} children. Room ${free ? 'available' : 'NOT available or not current'}.`,
      actor: AG01,
    })

    return {
      ok: true,
      output: {
        taskId,
        available: free,
        handoff: true,
        phrase: deskPhrase(lang, free ? 'changeAvailable' : 'changeUnavailable', {
          arrival: formatDate(dates.arrival, lang),
          departure: formatDate(dates.departure, lang),
        }),
      },
    }
  },
}

const getPaymentStatusTool: Tool = {
  name: 'get_payment_status',
  description: "State what has been paid on this guest's booking",
  input: NONE,
  reversible: false,
  run: async (context) => {
    const facts = await stay(context)
    if (typeof facts === 'string') return fail(facts)

    const lang = locale(context)
    const total = formatMoney(facts.totalCents, facts.currency, lang)

    return {
      ok: true,
      output: {
        paidCents: facts.paidCents,
        totalCents: facts.totalCents,
        phrase:
          facts.paidCents > 0
            ? deskPhrase(lang, 'paymentStatus', {
                paid: formatMoney(facts.paidCents, facts.currency, lang),
                total,
              })
            : deskPhrase(lang, 'paymentNone', { total }),
      },
    }
  },
}

const explainChargesTool: Tool = {
  name: 'explain_charges',
  description: "Explain the total, what is paid and what remains on this guest's booking",
  input: NONE,
  reversible: false,
  run: async (context) => {
    const facts = await stay(context)
    if (typeof facts === 'string') return fail(facts)

    const lang = locale(context)
    const money = (cents: number) => formatMoney(cents, facts.currency, lang)

    return {
      ok: true,
      output: {
        phrase: deskPhrase(lang, 'charges', {
          total: money(facts.totalCents),
          paid: money(facts.paidCents),
          balance: money(Math.max(0, facts.totalCents - facts.paidCents)),
        }),
      },
    }
  },
}

const sendPrearrivalLinkTool: Tool = {
  name: 'send_prearrival_link',
  description: 'Send the pre-arrival link to the email on this booking',
  input: NONE,
  reversible: false,
  write: true,
  run: async (context) => {
    const facts = await stay(context)
    if (typeof facts === 'string') return fail(facts)
    if (!facts.hasGuestEmail) return fail('no email on the booking')

    const outcome = await sendPrecheckinInvite({
      propertyId: context.propertyId,
      reservationId: facts.reservationId,
    })
    // "Already invited" still means the guest has a link in their inbox.
    if (outcome.status === 'rejected') return fail(outcome.reason)

    return {
      ok: true,
      output: { status: outcome.status, phrase: deskPhrase(locale(context), 'prearrivalSent') },
    }
  },
}

const recordEtaTool: Tool = {
  name: 'record_eta',
  description: "Record the guest's expected arrival time",
  input: TIME,
  reversible: true,
  write: true,
  run: async (context, input) => {
    const time = typeof input.time === 'string' ? input.time.trim() : ''
    if (!TIME_RE.test(time)) return fail('time must be HH:MM')
    if (!context.reservationId) return fail('no reservation in context')

    const outcome = await setExpectedArrival({
      propertyId: context.propertyId,
      reservationId: context.reservationId,
      time,
    })
    if (outcome.status !== 'set') return fail(outcome.reason)

    return {
      ok: true,
      output: { time, phrase: deskPhrase(locale(context), 'etaRecorded', { time }) },
    }
  },
}

const getCaptureStatusTool: Tool = {
  name: 'get_capture_status',
  description: 'State what is still missing before arrival',
  input: NONE,
  reversible: false,
  run: async (context) => {
    const facts = await stay(context)
    if (typeof facts === 'string') return fail(facts)

    const lang = locale(context)
    const missing = facts.outstanding.filter((item) => item !== 'arrival')
    if (missing.length === 0)
      return { ok: true, output: { missing, phrase: deskPhrase(lang, 'captureComplete') } }

    const items = missing.map((item) =>
      deskPhrase(lang, item === 'details' ? 'captureDetails' : 'captureDocuments'),
    )
    return {
      ok: true,
      output: { missing, phrase: deskPhrase(lang, 'captureMissing', { items: items.join(', ') }) },
    }
  },
}

const requestLateCheckoutTool: Tool = {
  name: 'request_late_checkout',
  description: 'Ask the property for a late checkout',
  input: TIME,
  reversible: true,
  write: true,
  run: async (context, input) => {
    const time = typeof input.time === 'string' ? input.time.trim() : ''
    if (!TIME_RE.test(time)) return fail('time must be HH:MM')
    if (!context.reservationId) return fail('no reservation in context')

    const taskId = await createStayTask({
      propertyId: context.propertyId,
      reservationId: context.reservationId,
      threadId: context.threadId ?? null,
      summary: `Late checkout requested until ${time}.`,
      actor: AG01,
    })

    return {
      ok: true,
      output: {
        taskId,
        handoff: true,
        phrase: deskPhrase(locale(context), 'lateCheckoutRequested', { time }),
      },
    }
  },
}

const requestInvoiceTool: Tool = {
  name: 'request_invoice',
  description: 'Ask the property to issue an invoice, and to whom',
  input: {
    type: 'object',
    properties: {
      billTo: {
        type: 'string',
        description: 'Who the invoice is for: a name or a company, as the guest wrote it',
      },
    },
    required: ['billTo'],
    additionalProperties: false,
  },
  reversible: false,
  write: true,
  run: async (context, input) => {
    const billTo = typeof input.billTo === 'string' ? input.billTo.trim() : ''
    if (!billTo) return fail('who to bill is required')
    if (!context.reservationId) return fail('no reservation in context')

    // Routed to the property, who issue it through their own chain. We issue
    // nothing (D11, binding rule 6).
    const request = await requestInvoice({
      propertyId: context.propertyId,
      reservationId: context.reservationId,
      billTo,
    })

    return {
      ok: true,
      output: { requestId: request.id, phrase: deskPhrase(locale(context), 'invoiceRequested') },
    }
  },
}

const logComplaintTool: Tool = {
  name: 'log_complaint',
  description: 'Record a complaint with its category, and tell the manager',
  input: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['room', 'noise', 'cleanliness', 'staff', 'billing', 'safety', 'other'],
      },
      summary: { type: 'string', description: "One line, in the guest's words" },
    },
    required: ['category', 'summary'],
    additionalProperties: false,
  },
  reversible: false,
  write: true,
  run: async (context, input) => {
    const category = isComplaintCategory(input.category) ? input.category : 'other'
    const summary = typeof input.summary === 'string' ? input.summary : ''
    if (!summary.trim()) return fail('a summary is required')
    if (!context.reservationId) return fail('no reservation in context')

    const complaint = await logComplaint({
      propertyId: context.propertyId,
      reservationId: context.reservationId,
      threadId: context.threadId ?? null,
      category,
      summary,
      actor: AG01,
    })

    // The owner is told now, not when the SLA runs out (WP0.3 AC: within 60 s).
    if (context.threadId && context.appUrl) {
      const alerted = await alertEscalation({
        propertyId: context.propertyId,
        reservationId: context.reservationId,
        threadId: context.threadId,
        escalatedAt: new Date(),
        appUrl: context.appUrl,
      })
      if (alerted) await markComplaintOwnerAlerted(context.propertyId, complaint.id)
    }

    return {
      ok: true,
      output: {
        complaintId: complaint.id,
        slaMinutes: complaint.slaMinutes,
        handoff: true,
        phrase: deskPhrase(locale(context), 'complaintLogged'),
      },
    }
  },
}

const notifyOwnerTool: Tool = {
  name: 'notify_owner',
  description: 'Tell the manager about this conversation',
  input: NONE,
  reversible: false,
  write: true,
  run: async (context) => {
    if (!context.reservationId || !context.threadId || !context.appUrl)
      return fail('no conversation in context')

    const alerted = await alertEscalation({
      propertyId: context.propertyId,
      reservationId: context.reservationId,
      threadId: context.threadId,
      escalatedAt: new Date(),
      appUrl: context.appUrl,
    })
    if (!alerted) return fail('no manager contact on record')

    return {
      ok: true,
      output: {
        notificationId: alerted,
        handoff: true,
        phrase: deskPhrase(locale(context), 'ownerNotified'),
      },
    }
  },
}

// ------------------------------------------------------------- owner, read-only

/**
 * The stays an owner answer names. Recorded beside the phrase, which names the
 * guests, so a guest's erasure finds the run that listed them: no thread leads
 * to an owner's question.
 */
function stayIds(rows: { reservationId: string | null }[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.reservationId ? [row.reservationId] : [])))]
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

const listArrivalsTool: Tool = {
  name: 'list_arrivals',
  description: 'List arrivals for a day (default tomorrow)',
  input: {
    type: 'object',
    properties: { date: { type: 'string', description: 'YYYY-MM-DD; default tomorrow' } },
    additionalProperties: false,
  },
  reversible: false,
  run: async (context, input) => {
    const date = typeof input.date === 'string' && DATE_RE.test(input.date) ? input.date : isoDay(1)
    const rows = await listArrivalsOn(context.propertyId, date)
    const lang = locale(context)
    const when = formatDate(date, lang)

    if (rows.length === 0)
      return {
        ok: true,
        output: { count: 0, phrase: deskPhrase(lang, 'ownerArrivalsNone', { date: when }) },
      }

    const names = rows.map((row) => row.guestName ?? row.reference ?? '—').join(', ')
    return {
      ok: true,
      output: {
        count: rows.length,
        reservationIds: stayIds(rows),
        phrase: deskPhrase(lang, 'ownerArrivals', { count: rows.length, date: when, names }),
      },
    }
  },
}

const listCaptureStatusTool: Tool = {
  name: 'list_capture_status',
  description: 'List arriving guests who have not finished pre-arrival',
  input: NONE,
  reversible: false,
  run: async (context) => {
    const rows = await listCaptureOutstanding(context.propertyId, isoDay(0), isoDay(3))
    const lang = locale(context)
    if (rows.length === 0)
      return { ok: true, output: { count: 0, phrase: deskPhrase(lang, 'ownerCaptureNone') } }

    const list = rows
      .map((row) => {
        const missing = row.missing.map((item) =>
          deskPhrase(lang, item === 'details' ? 'captureDetails' : 'captureDocuments'),
        )
        return `${row.guestName ?? '—'} (${formatDate(row.arrivalDate, lang)}: ${missing.join(', ')})`
      })
      .join('; ')

    return {
      ok: true,
      output: {
        count: rows.length,
        reservationIds: stayIds(rows),
        phrase: deskPhrase(lang, 'ownerCapture', { list }),
      },
    }
  },
}

const listOpenComplaintsTool: Tool = {
  name: 'list_open_complaints',
  description: 'List complaints not yet resolved',
  input: NONE,
  reversible: false,
  run: async (context) => {
    const rows = await listOpenComplaints(context.propertyId)
    const lang = locale(context)
    if (rows.length === 0)
      return { ok: true, output: { count: 0, phrase: deskPhrase(lang, 'ownerComplaintsNone') } }

    const list = rows
      .map((row) => `${row.guestName ?? '—'}: ${complaintCategoryLabel(lang, row.category)}`)
      .join('; ')
    return {
      ok: true,
      output: {
        count: rows.length,
        reservationIds: stayIds(rows),
        phrase: deskPhrase(lang, 'ownerComplaints', { count: rows.length, list }),
      },
    }
  },
}

const listPendingApprovalsTool: Tool = {
  name: 'list_pending_approvals',
  description: 'List actions waiting for the owner or staff to approve',
  input: NONE,
  reversible: false,
  run: async (context) => {
    const rows = await listPendingApprovals(context.propertyId)
    const lang = locale(context)
    if (rows.length === 0)
      return { ok: true, output: { count: 0, phrase: deskPhrase(lang, 'ownerApprovalsNone') } }

    const list = rows.map((row) => row.tool).join(', ')
    return {
      ok: true,
      output: {
        count: rows.length,
        phrase: deskPhrase(lang, 'ownerApprovals', { count: rows.length, list }),
      },
    }
  },
}

/*
 * The owner's filings (WP1.5). Read-only, like the rest of this section: the
 * owner learns what is owed and by when, and files from the console — an agent
 * never files, retries or marks anything as filed (hard rules: a compliance
 * outcome is never T1).
 */
const OWNER_LIST_LIMIT = 20

/**
 * At most `OWNER_LIST_LIMIT` filings, and a count that says when there are
 * more: "20" for a list that is complete, "20+" for one that is not.
 */
async function ownerObligations(propertyId: string, which: 'due' | 'failed') {
  const rows = await listObligationsForOwner(propertyId, which, OWNER_LIST_LIMIT + 1)
  const more = rows.length > OWNER_LIST_LIMIT
  return {
    rows: rows.slice(0, OWNER_LIST_LIMIT),
    more,
    count: more ? `${OWNER_LIST_LIMIT}+` : String(rows.length),
  }
}

const listObligationsDueTool: Tool = {
  name: 'list_obligations_due',
  description:
    'List statutory filings (police registration, ISTAT, tourist tax) not yet made, soonest deadline first',
  input: NONE,
  reversible: false,
  run: async (context) => {
    const { rows, more, count } = await ownerObligations(context.propertyId, 'due')
    const lang = locale(context)
    if (rows.length === 0)
      return { ok: true, output: { count: 0, phrase: deskPhrase(lang, 'ownerObligationsDueNone') } }

    const list = rows
      .map((row) =>
        deskPhrase(lang, 'ownerObligationDueItem', {
          subject: row.subject,
          filing: filingLabel(lang, row.authority),
          deadline: formatDeadline(row.deadline, lang, row.timeZone),
        }),
      )
      .join('; ')
    return {
      ok: true,
      output: {
        count: rows.length,
        more,
        reservationIds: stayIds(rows),
        phrase: deskPhrase(lang, 'ownerObligationsDue', { count, list }),
      },
    }
  },
}

const listObligationsFailedTool: Tool = {
  name: 'list_obligations_failed',
  description: 'List statutory filings that failed or must be filed by hand',
  input: NONE,
  reversible: false,
  run: async (context) => {
    const { rows, more, count } = await ownerObligations(context.propertyId, 'failed')
    const lang = locale(context)
    if (rows.length === 0)
      return {
        ok: true,
        output: { count: 0, phrase: deskPhrase(lang, 'ownerObligationsFailedNone') },
      }

    const list = rows
      .map((row) =>
        deskPhrase(lang, 'ownerObligationFailedItem', {
          subject: row.subject,
          filing: filingLabel(lang, row.authority),
          state: obligationStateLabel(lang, row.state),
        }),
      )
      .join('; ')
    return {
      ok: true,
      output: {
        count: rows.length,
        more,
        reservationIds: stayIds(rows),
        phrase: deskPhrase(lang, 'ownerObligationsFailed', { count, list }),
      },
    }
  },
}

export const guestDeskTools: Tool[] = [
  // Real since WP0.2, under the names the profiles use.
  alias(
    'search_knowledge',
    'Look up an answer the property has written for this question',
    searchKbTool,
    QUESTION,
  ),
  alias('find_booking', "State the facts of this guest's own booking", getReservationTool, NONE),
  alias(
    'get_hotel_policy',
    'Return the property answer stored under an exact topic',
    getPropertyInfoTool,
    TOPIC,
  ),

  // WP0.3.
  checkAvailabilityTool,
  {
    ...checkAvailabilityTool,
    name: 'quote_stay',
    description: 'Quote the total for a stay from the rate table',
  },
  createBookingLinkTool,
  modifyBookingTool,
  getPaymentStatusTool,
  explainChargesTool,
  sendPrearrivalLinkTool,
  recordEtaTool,
  getCaptureStatusTool,
  requestLateCheckoutTool,
  requestInvoiceTool,
  logComplaintTool,
  notifyOwnerTool,
  listArrivalsTool,
  listCaptureStatusTool,
  listOpenComplaintsTool,
  listPendingApprovalsTool,
  listObligationsDueTool,
  listObligationsFailedTool,

  // Approval-held; run from the approval step (WP0.6).
  notYet('cancel_booking', "Cancel this guest's own booking within policy", NONE, false),
  notYet('create_payment_link', "Create a payment link for this guest's booking", NONE, true),
]
