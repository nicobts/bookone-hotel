// Guest-journey state machine — the single source of stay truth (ADR-013).
//
//   booking.confirmed -> precheckin.invited -> precheckin.submitted
//   -> documents.validated -> alloggiati.staged -> arrival.confirmed
//   -> alloggiati.submitted -> stay.active -> departure.settled -> stay.closed
//
// Transitions happen only via evented commands. Every trigger source (console,
// agents, voice concierge, later door events from Rooms) enters through this
// machine — no module writes `journey_states` directly.
//
// Fills in Sprint 2 (03-ARCHITECTURE §5).
export {}
