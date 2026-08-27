# ADR-007 — RLS is the tenant-isolation mechanism, tested in CI

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Multi-tenant SaaS with guest-facing surfaces; an application-layer-only scoping bug would be catastrophic.

**Decision.** RLS on every client-reachable table keyed by property claims; guests use short-lived signed tokens resolved server-side (no guest Supabase sessions). Automated cross-tenant access suite runs per-role in CI as a merge gate. Service-role queries must still scope explicitly.

**Consequences.** (+) Defense in depth; isolation is provable, not assumed. (−) RLS policies are versioned SQL that must evolve with schema — same PR, reviewed together.
