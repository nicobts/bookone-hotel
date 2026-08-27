# ADR-001 — Platform owns its data model; external PMS is a sync source

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** The product must integrate with Ericsoft today and be usable standalone tomorrow. Building on Ericsoft's data shapes makes standalone a rewrite; building standalone-only makes adoption require migration, which kills sales.

**Decision.** Canonical domain model with platform-owned UUIDs from day one. External systems attach via `external_refs`. Authority is configured **per domain per property** (`AuthorityMap`); writes route accordingly. (D10, D12)

**Consequences.** (+) Graduation = flipping a source, not migrating a product; PMS API revocation accelerates rather than blocks us. (−) Sync + reconciliation engine is a real product component; canonical model needs design care upfront. Guard: external ids as keys = CI failure.
