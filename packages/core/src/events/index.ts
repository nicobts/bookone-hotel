// Append-only domain event emitter.
//
// Every mutation in the platform emits a `domain_events` row carrying the actor
// and the origin (`platform | sync | reconciliation`) — binding rule 2,
// 03-ARCHITECTURE §2. Agents appear here as `actor='agent:{name}'` (ADR-011).
//
// Fills in day-1 task 3.
export {}
