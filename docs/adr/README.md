# Architecture Decision Records

A decision goes here when reversing it later would be expensive — in money,
migration effort, liability, or trust. Everything else is just code, and code is
cheap to change.

**ADRs override anything conflicting elsewhere in the doc set.** Precedence is
ADRs > docs/00–08 > annexes/business.

## Rules

1. **One decision per record.** If a title needs "and", it is two records.
2. **Three-digit numbers**, assigned in order, never reused. `ADR-007`.
   (Numbering is inherited from the handoff; do not renumber — roughly fifty
   references across the doc set and the codebase cite these numbers.)
3. **Accepted records are immutable.** New information does not edit an old
   record; it supersedes it. Superseding requires a new ADR that references the
   old one — never edit history.
4. **`Depends on:` when it applies.** A record that builds on earlier ones lists
   them by number. Without this the log becomes unnavigable at around thirty
   entries, and unnavigable means unread.
5. **Status distinguishes decided from built.** `Accepted` → `Accepted
   (as-built)` once shipped, or `Superseded by ADR-0NN`.
6. **State the counterfactual.** What happens if we don't? A record that cannot
   answer that is describing a preference, not a decision.

Copy `TEMPLATE.md` to start. `IMPLEMENTATION-STATUS.md` tracks which accepted
decisions are actually built — a decision recorded is not a decision shipped.

ADR-001 through ADR-015 arrived as one file at documentation handoff and were
split here unchanged; their bodies are verbatim, with only a status line added.

## Index

| # | Title | Status |
|---|---|---|
| [001](ADR-001-platform-owns-its-data-model.md) | Platform owns its data model; external PMS is a sync source | Accepted |
| [002](ADR-002-fiscal-core-is-gated.md) | Fiscal core is gated (Rung 6) | Accepted |
| [003](ADR-003-two-deployables-one-database.md) | Two deployables, one database; worker is a persistent process | Superseded by 030 |
| [004](ADR-004-hono-over-fastify.md) | Hono over Fastify | Accepted |
| [005](ADR-005-pg-boss-over-redis-bullmq.md) | pg-boss over Redis + BullMQ | Accepted |
| [006](ADR-006-supabase-eu-as-managed-postgres.md) | Supabase (EU/Frankfurt) as managed Postgres + Auth + Storage | Accepted |
| [007](ADR-007-rls-is-the-tenant-isolation-mechanism.md) | RLS is the tenant-isolation mechanism, tested in CI | Accepted |
| [008](ADR-008-mock-first-connector-strategy.md) | Mock-first connector strategy | Accepted |
| [009](ADR-009-voice-hard-tool-boundaries.md) | Voice: speech-to-speech with hard tool boundaries; EU residency as a pre-filter | Accepted |
| [010](ADR-010-stripe-first-behind-a-payment-adapter.md) | Stripe first, behind a PaymentAdapter | Accepted |
| [011](ADR-011-agents-are-first-class-workers.md) | Agents are first-class workers with tiered autonomy | Accepted |
| [012](ADR-012-llm-provider-abstraction.md) | LLM provider abstraction with EU processing requirement | Accepted · amended by 029 |
| [013](ADR-013-guest-journey-is-an-evented-state-machine.md) | Guest journey is an evented state machine and the single source of stay truth | Accepted |
| [014](ADR-014-reference-implementations-over-blank-page-design.md) | Reference implementations over blank-page design | Accepted |
| [015](ADR-015-pricing-in-per-room-month-equivalence.md) | Pricing displayed in €/room/month equivalence | Accepted |
| [016](ADR-016-property-in-the-url.md) | The active property is a URL segment | Accepted |
| [017](ADR-017-identity-tables-outside-tenancy.md) | Identity tables sit outside tenancy | Accepted |
| [018](ADR-018-rls-enforcement-on-the-drizzle-path.md) | RLS is enforced on the Drizzle path via withUser | Accepted (as-built) |
| [019](ADR-019-feature-flags-are-entitlements.md) | Per-property feature flags are entitlements, gated where the property is known | Accepted |
| [020](ADR-020-statutory-registration-is-not-fiscal-core.md) | Statutory guest-registration reporting is not fiscal core | Accepted |
| [021](ADR-021-one-orchestrator-profiles-as-data.md) | Guest conversations run through one orchestrator routing to profiles defined as data | Accepted |
| [022](ADR-022-the-model-selects-tools-speak.md) | The model selects; tools author every guest-facing sentence | Accepted |
| [023](ADR-023-ai-sdk-behind-llm-provider.md) | The agent runtime is the Vercel AI SDK behind LlmProvider, not an agent framework | Accepted · amended by 029 |
| [024](ADR-024-replay-conversations-extend-the-evals-gate.md) | Replayable guest conversations extend the existing evals gate | Accepted |
| [025](ADR-025-workflow-engine-deferred.md) | Long-running processes are state columns and pg-boss jobs until a named trigger fires | Proposed |
| [026](ADR-026-compliance-adapter-contract.md) | Every authority integration is a ComplianceAdapter with a manual fallback | Accepted |
| [027](ADR-027-bookone-never-asserts-identity.md) | BookOne never asserts a guest's identity; de visu is staff-assisted behind an adapter | Accepted (module gated) |
| [028](ADR-028-region-first-expansion.md) | Expansion is one region at a time, each a registry entry | Accepted |
| [029](ADR-029-model-processing-may-leave-the-eu.md) | Stored data stays in the EU; model and vision processing may run outside it | Accepted |
| [030](ADR-030-three-deployables-admin-in-own-container.md) | Three deployables: the admin console runs in its own container, never on a third-party platform | Superseded by 034 |
| [031](ADR-031-operators-act-through-an-audited-console.md) | BookOne operators act only through an audited console with its own identity store | Accepted |
| [032](ADR-032-ops-security-baseline.md) | The ops and security baseline is a fixed list delivered in priority order | Accepted |
| [033](ADR-033-self-hosted-until-first-contract.md) | Our containers run self-hosted until the first signed contract, then on GCP Cloud Run | Accepted |
| [034](ADR-034-api-split-from-worker.md) | Webhooks and internal endpoints move to `apps/api`; the worker runs jobs only | Accepted |
| [035](ADR-035-twilio-for-whatsapp-and-sms.md) | WhatsApp and SMS go through Twilio, initially | Accepted |
| [036](ADR-036-opentelemetry-in-every-service.md) | Every service emits OpenTelemetry traces, metrics and logs | Accepted |
| [037](ADR-037-chat-interface-on-the-ai-sdk-ui-protocol.md) | A shared chat interface on the AI SDK UI protocol, first as an agent preview | Accepted |
| [038](ADR-038-hotels-preview-agents-without-side-effects.md) | Hotels see and preview their agents in the console, without side effects | Accepted |
| [039](ADR-039-compliance-obligations-are-a-state-table.md) | Compliance obligations are a state table that adapters discharge | Accepted |

ADR-019 to ADR-034 come from the Guest Desk handoff (`docs/guest_desk_20260927/`, ADR-F1…F13 and UPGRADE-01),
amended where the WP0.1 inventory ([11-inventory.md](../11-inventory.md)) found the handoff's
premise false for this repo. Each record names its origin. The handoff's F-numbered files are
source material, not part of this log.
