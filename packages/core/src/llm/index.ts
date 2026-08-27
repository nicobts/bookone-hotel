// LlmProvider abstraction (ADR-012, D18).
//
// The only path to a model, anywhere in the codebase. Per-agent task-tiered
// model config; EU processing verified and the provider entered in the
// sub-processor register before first use; cost recorded per run into
// `agent_runs.cost_cents`. No module outside this directory imports a vendor
// SDK — enforced by the no-restricted-imports rule in eslint.config.mjs.
//
// Fills in day-1 task 3.
export {}
