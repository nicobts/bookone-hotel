# ADR-005 — pg-boss over Redis + BullMQ

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Earlier annexes assumed Redis+BullMQ. At V1 volume (≤10k jobs/day), a second stateful service adds ops surface and another residency line for no benefit.

**Decision.** pg-boss on the existing Postgres, behind a `JobQueue` interface.

**Consequences.** (+) One fewer service; transactional enqueue with domain writes; EU residency inherited. (−) Throughput ceiling — revisit via the interface if job volume grows 10×. Supersedes the Redis choice in the Concierge annex for this codebase.
