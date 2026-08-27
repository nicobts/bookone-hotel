// Typed domain tools — the complete surface through which agents act.
//
// A tool is a domain command, identical to the one a human path calls, so an
// agent write is indistinguishable in effect and fully distinguishable in audit
// (`actor='agent:{name}'`). Guest-facing tools return pre-formed `phrase`
// fields so no model ever composes a price, a date or an availability claim.
//
// If an agent needs a capability, the tool gets built. There is no fallback to
// direct database access (ADR-011).
export {}
