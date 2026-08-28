// LlmProvider abstraction (ADR-012, D18) — the only path to a model.
//
// The prohibition on vendor SDK imports outside this directory is enforced by
// `no-restricted-imports` in eslint.config.mjs, not by convention.
export * from './provider'
export * from './registry'
