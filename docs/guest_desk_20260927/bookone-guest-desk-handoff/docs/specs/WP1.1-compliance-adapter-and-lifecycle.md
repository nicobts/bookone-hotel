# WP1.1 — ComplianceAdapter contract, schedina lifecycle, evidence store, region registry
Depends on: Phase 0 gate passed · Est.: 1 week · Blocked on: nothing

## Build
- `ComplianceAdapter` interface (ADR-F3): `capabilities()`, `validate(obligation)`, `submit(obligation)`, `manualFallback(obligation)`; capability declaration: jurisdiction, obligationTypes, transport, evidenceType, retryPolicy.
- Region registry: tenant → region → adapters (national + regional + municipal), data-driven.
- `Obligation` table: tenant, guest/booking/day, authority, type, deadline, state (pending → queued → submitted → acknowledged | failed → manual), attempts, evidence_id. `SubmissionEvidence`: raw receipt, hash, timestamp.
- Schedina lifecycle extended from WP0.4: `staff_confirmed → queued → submitted → acknowledged`.
- State machine + pg-boss jobs + cron (ADR-F5 starting point). Log every wait point; this data decides ADR-F5.

## Acceptance criteria
- [ ] A fake adapter passes the contract test suite (submit, retry, fail → manual, evidence stored).
- [ ] Obligations are generated automatically from confirmed schedine and arrivals.
- [ ] Manual fallback produces a file/data view usable in under 2 minutes (walkthrough).
## Stop and ask
Any deviation from the ADR-F3 interface.
