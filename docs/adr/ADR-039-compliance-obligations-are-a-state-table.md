# ADR-039 — Compliance obligations are a state table that adapters discharge

**Status:** Accepted · **Date:** 2026-09-28
**Depends on:** ADR-025 (no workflow engine yet), ADR-026 (ComplianceAdapter), ADR-028 (region registry) · **Supersedes:** nothing
**Origin:** Guest Desk WP1.1 (`docs/guest_desk_20260927/bookone-guest-desk-handoff/docs/specs/WP1.1-compliance-adapter-and-lifecycle.md`)

## Triggering event

WP1.1 has to turn ADR-026's capability list into code, and ADR-026 gives no signature. The WP1.1
spec names four methods — `capabilities()`, `validate(obligation)`, `submit(obligation)`,
`manualFallback(obligation)` — and says any deviation from that interface stops the work. The
Sprint 6 `AlloggiatiAdapter` has a different shape (`submit`, `checkAcknowledgement`,
`healthCheck`). Both have to fit without a fifth method.

## Context

Three facts shape the decision.

- **Filings wait.** A queued channel acknowledges hours after the upload. The Sprint 6 code polls for
  that with `checkAcknowledgement`, which the spec's interface does not have.
- **Filings are due.** Alloggiati is 24 hours from arrival; the regional ISTAT return is daily; the
  imposta is per period. The Phase 1 gate is zero missed 24-hour deadlines and evidence for every
  submission. Neither lives in an adapter.
- **ADR-025 defers a workflow engine** until we can see the pain: more than about five wait points in
  one process, compensation across adapters, or "where is this stuck" needing more than one query.

## Decision

**An obligation is a row.** `compliance_obligations` holds one row per thing a property owes an
authority. It records:

- the property;
- the adapter that discharges it;
- the authority and the type (`guest_registration`, `istat_movement`,
  `tourist_tax_declaration`);
- a subject key (`reservation:<id>` or `day:<date>`), unique per property, adapter and type, so
  generating twice creates nothing;
- the deadline;
- the state;
- attempts, the next attempt time and the last error.

States: `pending → queued → submitted → acknowledged`, with `failed → queued` for a retry and
`failed → manual` when retries run out or the deadline is too close. `manual` can still end
`acknowledged` when a person files by hand. The transitions are one pure function
(`compliance/lifecycle.ts`), and every transition emits a domain event carrying how long the
obligation waited in the state it left. That is the data ADR-025 needs.

**Evidence is append-only.** `compliance_evidence` stores:

- the receipt the authority returned;
- its SHA-256;
- who or what recorded it.

A trigger refuses DELETE and TRUNCATE, except when the owning property itself is being deleted. It
refuses every UPDATE except the retention sweep blanking the receipt. The hash, the timestamps and
the row stay.

**The adapter has exactly the four methods of the spec.**

```ts
interface ComplianceAdapter {
  capabilities(): ComplianceCapabilities
  validate(obligation: ObligationInput): Promise<ValidationResult>
  submit(obligation: ObligationInput): Promise<SubmitResult>
  manualFallback(obligation: ObligationInput): Promise<ManualFallback>
}
```

- **Capabilities.** `capabilities()` declares everything ADR-026 lists, so the lifecycle reads the
  retry policy from the adapter rather than hard-coding one:
  - adapter id, feature and simulated flag;
  - jurisdiction and obligation types;
  - transport and evidence type;
  - retry policy (attempts, backoff, and the margin before the deadline at which it gives up and goes
    manual);
  - manual-fallback format.
- **Submit is idempotent on the obligation.** A second `submit` for an obligation already filed must
  not file again. It returns the channel's current answer, `submitted` or `acknowledged` with its
  receipt. That is how a queued channel's acknowledgement is collected, without a fifth method: the
  sweep submits a `submitted` obligation again, and the adapter asks the channel instead of
  re-sending. The Alloggiati implementation already refuses to re-file (one
  `alloggiati_submissions` row per stay and channel), so its bridge only has to ask.

**The registry is data.** `compliance/registry.json` maps regions to their regional adapter and
their comuni to municipal rule tables. The national adapters apply everywhere. A property's region
and comune are in `properties.settings.jurisdiction`, read through a schema. A region with no
regional adapter yields no regional obligation; the console says so and the manual route applies
(ADR-028). No code branches on a region name. Adapter implementations are registered by id at worker
boot, so an id in the registry with no implementation is reported, not guessed at.

**Jobs, not an engine.**

- `compliance.generate` (every 10 minutes) creates obligations from confirmed schedine and arrivals.
- `compliance.sweep` (every 5 minutes) enqueues the due ones.
- `compliance.run` advances one obligation by one step.

The Sprint 6 `alloggiati.file` job now goes through the lifecycle.

## Cost of change / cost of not changing

**If wrong:** the table and the jobs are the pieces a workflow engine would replace. Obligations are
already durable rows with explicit states, so moving them into an engine later means a runner that
reads the same rows. The adapters don't change.

**If not done:** each authority keeps its own status column and its own retry loop, as Alloggiati has
today. The Phase 1 dashboard (WP1.6) and deadline engine (WP1.5) would then need one query per
authority. And "zero missed deadlines" could not be measured from one place.

## Alternatives rejected

- **A fifth method, `checkAcknowledgement`.** It is the obvious shape for a queued channel, but it is
  a deviation the spec forbids without a decision. Idempotent submit covers the same need, and the
  contract suite pins it down.
- **Extending the journey's `alloggiati` dimension to every authority.** The journey is per stay. The
  ISTAT return is per day and the imposta per period, and neither belongs to one stay. The journey
  keeps its `alloggiati` dimension, which the Alloggiati bridge still drives.
- **Region and comune as columns on `properties`.** They would add a migration and an RLS review for
  two values that only the registry reads. Settings already carry per-property configuration read
  through small schemas.
- **A workflow engine now.** ADR-025: not before the evidence.

## Consequences

- The lifecycle, the evidence store and the registry are the same for every authority. WP1.2–1.4 add
  an adapter and, for the imposta, a rules file.
- The Alloggiati trail (`alloggiati_submissions`, the journey dimension, `external_refs`) is
  unchanged. The obligation links to it through the reservation.
- WP1.1 generates `guest_registration` obligations only. The other two types exist in the enum for
  WP1.3 and WP1.4.
- Nothing is filed with any authority: the only Alloggiati implementation outside production is the
  mock, and the worker still refuses to boot simulated in production.
