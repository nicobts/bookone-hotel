// Stripe implementation of `PaymentAdapter` (ADR-010).
//
// Connect Standard per property; webhooks are the only state authority; card
// data never touches our servers (PCI SAQ-A). An Italian provider swap later is
// a new adapter against the same interface — the policy engine does not move.
//
// Fills in Sprint 4.
export {}
