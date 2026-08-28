// The payment port (ADR-010).
//
// MEMO: no payment provider is connected. `MockPaymentAdapter` is the only
// implementation and it moves no money — see its file header for what is real
// (the interface, the policy engine, the webhook path, the ledger) and what is
// not (the card form, the authorisation, the money).
export * from './adapter'
export * from './fees'
export * from './checkout'
export * from './webhook'
