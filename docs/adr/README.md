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
| [003](ADR-003-two-deployables-one-database.md) | Two deployables, one database; worker is a persistent process | Accepted |
| [004](ADR-004-hono-over-fastify.md) | Hono over Fastify | Accepted |
| [005](ADR-005-pg-boss-over-redis-bullmq.md) | pg-boss over Redis + BullMQ | Accepted |
| [006](ADR-006-supabase-eu-as-managed-postgres.md) | Supabase (EU/Frankfurt) as managed Postgres + Auth + Storage | Accepted |
| [007](ADR-007-rls-is-the-tenant-isolation-mechanism.md) | RLS is the tenant-isolation mechanism, tested in CI | Accepted |
| [008](ADR-008-mock-first-connector-strategy.md) | Mock-first connector strategy | Accepted |
| [009](ADR-009-voice-hard-tool-boundaries.md) | Voice: speech-to-speech with hard tool boundaries; EU residency as a pre-filter | Accepted |
| [010](ADR-010-stripe-first-behind-a-payment-adapter.md) | Stripe first, behind a PaymentAdapter | Accepted |
| [011](ADR-011-agents-are-first-class-workers.md) | Agents are first-class workers with tiered autonomy | Accepted |
| [012](ADR-012-llm-provider-abstraction.md) | LLM provider abstraction with EU processing requirement | Accepted |
| [013](ADR-013-guest-journey-is-an-evented-state-machine.md) | Guest journey is an evented state machine and the single source of stay truth | Accepted |
| [014](ADR-014-reference-implementations-over-blank-page-design.md) | Reference implementations over blank-page design | Accepted |
| [015](ADR-015-pricing-in-per-room-month-equivalence.md) | Pricing displayed in €/room/month equivalence | Accepted |
| [016](ADR-016-property-in-the-url.md) | The active property is a URL segment | Accepted |
