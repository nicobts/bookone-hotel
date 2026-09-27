import { getPropertyInfoTool, getReservationTool, searchKbTool } from './concierge'
import type { Tool } from './index'

/**
 * The Guest Desk profiles' tool names (ADR-021, WP0.2).
 *
 * Three already have a real implementation under an older name, and reuse it
 * rather than copy it. The rest belong to WP0.3 and exist here as **stubs that
 * refuse**. The handoff asked for stubs returning seeded data; that was
 * declined. Under ADR-022 a tool's `phrase` is what the guest reads, so a stub
 * that returned plausible data would be one enabled feature away from telling a
 * real guest a price nobody set. A refusal makes the orchestrator escalate, which
 * is the correct behaviour until the real action exists.
 */

const QUESTION = {
  type: 'object',
  properties: { question: { type: 'string', description: "The guest's question, in their words" } },
  required: ['question'],
  additionalProperties: false,
} as const

const NONE = { type: 'object', properties: {}, additionalProperties: false } as const

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
      output: { error: `${name} is not available yet (WP0.3)`, unavailable: true },
    }),
  }
}

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

export const guestDeskTools: Tool[] = [
  // Real today, under the names the profiles use.
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
  notYet('check_availability', 'Check which rooms are free for given dates', DATES, false),
  notYet('quote_stay', 'Quote a stay from the rate table', DATES, false),
  notYet('create_booking_link', 'Create a link to book the quoted stay', DATES, true),
  notYet(
    'modify_booking',
    "Change this guest's own booking within policy",
    {
      type: 'object',
      properties: {
        arrival: { type: 'string' },
        departure: { type: 'string' },
        adults: { type: 'integer' },
        children: { type: 'integer' },
      },
      additionalProperties: false,
    },
    true,
  ),
  notYet('cancel_booking', "Cancel this guest's own booking within policy", NONE, false),
  notYet('create_payment_link', "Create a payment link for this guest's booking", NONE, true),
  notYet('get_payment_status', "State what has been paid on this guest's booking", NONE, false),
  notYet('explain_charges', "Explain the charges on this guest's booking", NONE, false),
  notYet('send_prearrival_link', 'Send the pre-arrival link for this stay', NONE, true),
  notYet(
    'record_eta',
    "Record the guest's expected arrival time",
    {
      type: 'object',
      properties: { time: { type: 'string', description: 'HH:MM, 24-hour' } },
      required: ['time'],
      additionalProperties: false,
    },
    true,
  ),
  notYet('get_capture_status', 'State which documents are still missing', NONE, false),
  notYet(
    'request_late_checkout',
    'Ask the property for a late checkout',
    {
      type: 'object',
      properties: { time: { type: 'string', description: 'HH:MM, 24-hour' } },
      required: ['time'],
      additionalProperties: false,
    },
    true,
  ),
  notYet('request_invoice', 'Ask the property to issue an invoice', NONE, true),
  notYet(
    'log_complaint',
    'Record a complaint with its category',
    {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['room', 'noise', 'cleanliness', 'staff', 'billing', 'other'],
        },
        summary: { type: 'string' },
      },
      required: ['category', 'summary'],
      additionalProperties: false,
    },
    false,
  ),
  notYet('notify_owner', 'Tell the owner about this conversation', NONE, false),
  notYet('list_arrivals', 'List arrivals for a day', NONE, false),
  notYet('list_capture_status', 'List stays with documents still missing', NONE, false),
  notYet('list_open_complaints', 'List complaints not yet resolved', NONE, false),
  notYet('list_pending_approvals', 'List actions waiting for approval', NONE, false),
]
