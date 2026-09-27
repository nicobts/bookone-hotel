// The guest concierge (E3.2, E3.3, E3.4).
//
// AG-01 is the Guest Desk orchestrator (ADR-021, `packages/agents`): hard rules,
// routing to one profile, one tool, and a reply that is the `phrase` that tool
// returned — or an escalation. With no `LlmProvider` registered (no
// `OPENROUTER_API_KEY`) it routes by rules; with one (ADR-029), a model routes
// and picks the tool, and still writes nothing (ADR-022).
//
// That is not a placeholder for the interesting version. It is the shape the
// interesting version has to keep. A model widens *which* phrasings reach the
// right tool; it never composes the answer, because a generated guest-facing
// fact is what binding rule 7 and ADR-009 forbid. When a provider is registered,
// the thing that changes is recall, not authorship.
//
// `audit.ts` is what checks that claim after the fact, against what was actually
// sent, and its result is a merge gate.
export * from './alerts'
export * from './facts'
export * from './kb'
export * from './intent'
export * from './phrases'
export * from './routing'
export * from './complaints'
export * from './desk'
export * from './approvals'
export * from './thread'
export * from './audit'
