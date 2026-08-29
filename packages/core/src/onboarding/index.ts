// Onboarding, self-service configuration and entitlements (E7.1, E5.3, E7.3).
//
// The checklist is derived from the rows the product already reads — there is
// no stored progress flag, because a second source of truth drifts and then
// tells a new owner to do something they have already done.
//
// Nothing here gates the console on completion. Blocking items are the ones a
// booking would fail on anyway, and the surface says which.
export * from './checklist'
export * from './entitlements'
export * from './ingest'
export * from './knowledge'
