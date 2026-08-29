// Arrival, in-stay and departure (E3.1, E4.1).
//
// MEMO: no payment provider is connected. Every amount `checkout.ts` settles
// runs through `MockPaymentAdapter` and moves no money (ADR-010).
//
// Nothing here issues a fiscal document under any framing (D11, binding rule 6):
// an invoice request is recorded and routed to the property, who issues the
// fattura through their own certified chain.
export * from './arrival'
export * from './checkout'
export * from './door'
