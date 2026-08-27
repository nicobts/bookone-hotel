# ADR-012 — LLM provider abstraction with EU processing requirement

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** EU residency is non-negotiable (D9); model landscape shifts quarterly; different tasks need different price/quality points.

**Decision.** `LlmProvider` interface in `packages/core`; per-agent model config (task-tiered: extraction vs conversation vs classification); providers/endpoints must satisfy the EU-processing requirement and appear in the sub-processor register before use. No agent references a vendor SDK directly.

**Consequences.** (+) Swappable, cost-tunable, residency-verifiable. (−) Thin abstraction tax; a capability matrix per provider must be kept current.
