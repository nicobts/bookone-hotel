import type { Gate } from '@bookone/core/onboarding'

/**
 * Every internal route, classified (ADR-019).
 *
 * A route with a feature answers 404 for a property without it, before any
 * work — the same answer an unknown path gets, so a property cannot tell a
 * module it lacks from one that does not exist. `core` routes finish things
 * already started (cancelling an existing booking, confirming an arrival,
 * erasing a guest) and are never switched off by a flag.
 *
 * `app.test.ts` asserts that every `/jobs/*` route registered in `createApp`
 * appears here, so a new route cannot ship unclassified.
 */
export const ROUTE_FEATURE: Record<string, Gate> = {
  '/jobs/reservation-reflect': 'pms_sync',
  '/jobs/booking-confirmed': 'booking_engine',
  '/jobs/checkout': 'payments',
  // A guest cancelling a booking they already hold is not new business.
  '/jobs/cancel': 'core',
  '/jobs/cancellation-quote': 'core',
  // Arrival is the journey itself. What it triggers is gated separately.
  '/jobs/arrival-confirm': 'core',
  '/jobs/guest-message': 'inbox',
  '/jobs/depart': 'core',
  '/jobs/alloggiati-submit': 'alloggiati',
  '/jobs/document-extract': 'document_ocr',
  // Simulation only, and switched off by `allowSimulation`, not by a flag: the
  // body carries an intent id, not a property, so there is no property to ask.
  '/jobs/payment-intent': 'core',
  '/jobs/privacy-erase': 'core',
  '/jobs/retention-sweep': 'core',
  '/jobs/payment-simulate': 'core',
}
