// Guest-journey state machine — the single source of stay truth (ADR-013).
//
//   booking.confirmed -> precheckin.invited -> precheckin.submitted
//   -> documents.validated -> alloggiati.staged -> arrival.confirmed
//   -> alloggiati.submitted -> stay.active -> departure.settled -> stay.closed
//
// That chain is a path through five independent dimensions, not a single
// column — see machine.ts for why.
//
// Transitions happen only via evented commands. Every trigger source (console,
// agents, voice concierge, later door events from Rooms) enters through
// `applyJourneyCommand` — no module writes `journey_states` directly.
export * from './machine'
export * from './apply'
export * from './token'
export * from './precheckin'
export * from './invite'
