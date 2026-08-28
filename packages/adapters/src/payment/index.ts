// The shared `PaymentAdapter` contract suite, plus the future home of the real
// provider (ADR-010).
//
// A real implementation must pass `describePaymentAdapterContract` — the same
// suite `MockPaymentAdapter` passes — before it replaces the mock.
export * from './contract'
