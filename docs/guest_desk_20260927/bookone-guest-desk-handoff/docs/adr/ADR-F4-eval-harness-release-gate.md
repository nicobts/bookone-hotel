# ADR-F4 — Evaluation harness as a release gate for agent changes
Status: Accepted · Date: 2026-09-27

## Decision
A replay set of real, anonymised conversations (seeded in Phase 0 from each WP's `evals/` folder) runs on every prompt,
tool-schema or model change. Regression on resolution rate, escalation precision or unsafe-action count blocks the
release. Tooling: Arize Phoenix (self-hosted, EU) for traces and datasets; `scripts/replay-evals.ts` as runner; CI
gate from Phase 2.

## Consequences
+ Model/provider swaps become safe operations.
− Every WP pays the eval tax (≥5 conversations); no exceptions.
