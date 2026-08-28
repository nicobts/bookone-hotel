// Deposit and cancellation policy — provider-agnostic by design (ADR-010).
//
// Drives the deposit shown at booking and the refund shown before a
// cancellation is confirmed. Knows nothing about any payment provider, which is
// what makes the eventual Stripe-to-Italian-provider swap a change of adapter
// and not a change of terms.
export * from './booking-policy'
