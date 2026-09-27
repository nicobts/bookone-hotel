# ADR-026 — Every authority integration is a ComplianceAdapter with a manual fallback

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-008 (mock-first connectors), ADR-020 (statutory registration is not fiscal core) · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F3 (ComplianceAdapter half)

## Triggering event

Phase 1 adds two more authorities beside Alloggiati Web — WebTur FVG for ISTAT, and the Comune di
Trieste for the imposta — and the expansion plan (ADR-028) adds one regional system per region.
Sprint 6 built `AlloggiatiAdapter` as a one-off port. Three one-offs is the point to generalise,
before the second exists.

## Context

The existing connector doctrine (ADR-008): a port in core, a mock with failure injection, a shared
contract suite that a real implementation must pass before the swap, and a production boot guard
against simulated adapters. Authority systems add two things PMS connectors do not: statutory
deadlines, and the certainty that some of them will be unavailable, unspecified or unregistered when
a property needs to file.

## Decision

A `ComplianceAdapter` port in `packages/core` declares its capabilities:

- **jurisdiction** — national, region code, or comune code;
- **obligation types** it discharges;
- **submission transport** — web service, file upload, portal export;
- **evidence type** — what proves the filing (receipt, protocol number, checksum);
- **retry policy**;
- **manual-fallback format**.

**Every adapter ships a manual fallback**: portal-ready data a staff member can submit by hand in
under two minutes. The fallback is part of the contract suite, not an afterthought, because an
authority system without a published spec (WebTur) may reach production as fallback-only.

The existing `AlloggiatiAdapter` becomes the first implementation of this port in WP1.1; its mock,
contract tests and `alloggiati_submissions` evidence trail carry over. Adapters are looked up through
a region registry (ADR-028).

## Cost of change / cost of not changing

**If wrong:** one interface over three adapters; collapsing it back is a rename.

**If not done:** each authority gets its own lifecycle, deadline logic and dashboard, and the fourth
region costs as much as the first.

## Alternatives rejected

- **One port per authority, as Sprint 6 did.** Fine for one; for three, it duplicates the deadline
  and evidence logic that the Phase 1 gate (zero missed 24h deadlines, evidence per submission)
  measures.
- **Fallback only where the integration fails.** The fallback is the only thing that works on day
  one for an unspecified system.

## Consequences

- The interface is defined in WP1.1 before any new authority integration.
- Real filing still waits on the channel decision (04 §0 item 5) and counsel's review of
  `docs/contracts/alloggiati-responsibility.md`.
