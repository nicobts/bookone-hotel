// No imports on purpose: the agents catalogue, which apps/web reads, imports
// this file and must not pull in the tool implementations (ADR-038).

/**
 * The tools a preview may actually execute (ADR-038): they read, and change
 * nothing anywhere. Every tool *not* listed here is simulated in preview —
 * fail-closed, so a tool nobody classified is never run by a test turn.
 *
 * An allowlist rather than the `write` flag because the flag has already missed
 * one writer (`create_task`). `tools.test.ts` checks that no tool listed here is
 * flagged as a write and that every name exists.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // Answers the property wrote, and its policy.
  'search_knowledge',
  'search_kb',
  'get_hotel_policy',
  'get_property_info',
  // The guest's own booking, availability and prices: facts, read.
  'find_booking',
  'get_reservation',
  'check_availability',
  'quote_stay',
  'create_booking_link',
  'get_payment_status',
  'explain_charges',
  'get_capture_status',
  // The handover phrase only; the thread is escalated by the caller, and a
  // preview has no thread.
  'escalate',
  // The owner assistant's reads.
  'list_arrivals',
  'list_capture_status',
  'list_open_complaints',
  'list_pending_approvals',
  'list_obligations_due',
  'list_obligations_failed',
  // Arithmetic on its input.
  'classify_discrepancy',
])
