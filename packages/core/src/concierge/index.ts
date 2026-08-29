// The guest concierge (E3.2, E3.3, E3.4).
//
// MEMO: no model is connected. `LLM_API_KEY` is empty, no `LlmProvider` is
// registered, and AG-01 runs as a deterministic router: it matches the question
// against the property's knowledge base, calls typed tools, and replies with the
// `phrase` a tool returned — or escalates.
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
export * from './thread'
export * from './audit'
