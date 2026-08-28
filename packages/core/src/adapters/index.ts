// Outbound port interfaces. Implementations live in @bookone/adapters; the
// domain never depends on a concrete vendor.
//
//   PmsAdapter     — 03-ARCHITECTURE §4 (ADR-008, mock-first)
//   PaymentAdapter — 03-ARCHITECTURE §7 (ADR-010, Stripe first) — Sprint 4
//   JobQueue       — ADR-005 (pg-boss today, swappable at 10x volume) — Sprint 2
export * from './pms'
