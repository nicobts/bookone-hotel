// Alloggiati — the accommodated-persons registry (E2.3, E2.4).
//
// MEMO: no channel is connected. The direct-web-service versus certified-
// intermediary decision is open (04 §0 item 5), so this ships behind a port
// with a mock, exactly as the PMS connector and payments did.
//
// The payload layout and the country code lists both need verification against
// the authority's own specification before a real submission — see the header
// of record.ts and docs/runbooks/alloggiati.md.
export * from './record'
export * from './adapter'
export * from './submit'
