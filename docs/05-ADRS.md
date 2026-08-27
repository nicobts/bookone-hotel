# 05 — Architecture Decision Records

Format: Context → Decision → Consequences. Status: `accepted` unless noted. Superseding an ADR requires a new ADR referencing the old one — never edit history.

---

## ADR-001 — Platform owns its data model; external PMS is a sync source

**Context.** The product must integrate with Ericsoft today and be usable standalone tomorrow. Building on Ericsoft's data shapes makes standalone a rewrite; building standalone-only makes adoption require migration, which kills sales.

**Decision.** Canonical domain model with platform-owned UUIDs from day one. External systems attach via `external_refs`. Authority is configured **per domain per property** (`AuthorityMap`); writes route accordingly. (D10, D12)

**Consequences.** (+) Graduation = flipping a source, not migrating a product; PMS API revocation accelerates rather than blocks us. (−) Sync + reconciliation engine is a real product component; canonical model needs design care upfront. Guard: external ids as keys = CI failure.

## ADR-002 — Fiscal core is gated (Rung 6)

**Context.** SDI, corrispettivi, night audit carry legal liability and a permanent €130–180k/yr maintenance burden. Premature entry is the historically fatal failure mode of PMS challengers.

**Decision.** No fiscal-core development until C1–C6 verified simultaneously (≥25 properties at Rung 5; 6-month shadow parity ≥99.9% incl. observed year-end close; compliance resource contracted; revenue-funded; insurance extended; written decision revision). (D11)

**Consequences.** (+) Liability and burn contained; "PMS as fiscal printer" is an explicitly stable end-state. (−) We cannot claim "full PMS replacement" in sales material until then — and must not.

## ADR-003 — Two deployables, one database; worker is a persistent process

**Context.** Serverless request/response cannot hold PMS polling, queue workers, MQTT (Rooms), or long-lived connector state.

**Decision.** Next.js (Vercel fra1) for surfaces; Hono/Node worker (Fly/Hetzner EU) for jobs, connectors, sync, agents. Worker is never deployed to edge/serverless — stated in its README as a standing constraint.

**Consequences.** (+) Each half deploys on infrastructure suited to it. (−) Two deploy targets; shared logic must live in `packages/core` (enforced convention: neither app reimplements domain logic).

## ADR-004 — Hono over Fastify

**Context.** Both adequate; founder has active Hono production experience; Hono RPC gives end-to-end types to Next.js without codegen.

**Decision.** Hono on `@hono/node-server`. The edge-first temptation is explicitly rejected (see ADR-003).

**Consequences.** (+) Familiarity, shared types. (−) Slightly smaller Node-server ecosystem than Fastify; acceptable.

## ADR-005 — pg-boss over Redis + BullMQ

**Context.** Earlier annexes assumed Redis+BullMQ. At V1 volume (≤10k jobs/day), a second stateful service adds ops surface and another residency line for no benefit.

**Decision.** pg-boss on the existing Postgres, behind a `JobQueue` interface.

**Consequences.** (+) One fewer service; transactional enqueue with domain writes; EU residency inherited. (−) Throughput ceiling — revisit via the interface if job volume grows 10×. Supersedes the Redis choice in the Concierge annex for this codebase.

## ADR-006 — Supabase (EU/Frankfurt) as managed Postgres + Auth + Storage

**Context.** Solo founder; EU residency mandatory; RLS-based tenancy planned anyway.

**Decision.** Supabase EU project. Drizzle as the ORM for all domain access; supabase-js only where Auth/Storage/Realtime require it.

**Consequences.** (+) Auth, RLS, encrypted storage, PITR bundled. (−) US-owned provider in EU region (tier-1 residency claim, documented in sub-processor register); exit path is plain Postgres — no Supabase-proprietary features in the domain layer.

## ADR-007 — RLS is the tenant-isolation mechanism, tested in CI

**Context.** Multi-tenant SaaS with guest-facing surfaces; an application-layer-only scoping bug would be catastrophic.

**Decision.** RLS on every client-reachable table keyed by property claims; guests use short-lived signed tokens resolved server-side (no guest Supabase sessions). Automated cross-tenant access suite runs per-role in CI as a merge gate. Service-role queries must still scope explicitly.

**Consequences.** (+) Defense in depth; isolation is provable, not assumed. (−) RLS policies are versioned SQL that must evolve with schema — same PR, reviewed together.

## ADR-008 — Mock-first connector strategy

**Context.** Ericsoft API approval takes 2–5 months and is outside our control; exception paths are the hardest code and need failure conditions to exist.

**Decision.** `MockEricsoftAdapter` with deterministic fixtures and failure injection ships in Sprint 2. The real adapter must pass the mock's contract-test suite before swap. Beta may go live on mock + manual re-entry (parity with the hotel's current manual reality).

**Consequences.** (+) External calendar decoupled from build calendar; exception UX built early. (−) Contract tests must be maintained as the real API teaches us its quirks.

## ADR-009 — Voice: speech-to-speech with hard tool boundaries; EU residency as a pre-filter

**Context.** S2S wins on multilingual/noise/cost; cascaded wins on pre-utterance control and per-component EU endpoints. Rate hallucination is a commercial liability, not a bug.

**Decision.** Provider-abstracted `VoiceRuntime`. Bake-off on real recordings evaluates only EU-deployable options. Facts come only from tools; tools return pre-formed `phrase`; post-call audit of price/availability mentions without tool calls is a monitored metric. Any production hallucination incident moves the transactional path to cascaded.

**Consequences.** (+) Best conversational quality without unbounded liability. (−) Discipline lives in prompt+audit rather than pipeline structure; the audit is therefore non-optional.

## ADR-010 — Stripe first, behind a PaymentAdapter

**Context.** Italian providers (Nexi/Axerve) may be preferable commercially later; Stripe ships fastest with SCA, vaulting, Connect, SAQ-A scope.

**Decision.** Stripe Connect Standard per property; all payment logic behind `PaymentAdapter`; policy engine and folio-lite are provider-agnostic.

**Consequences.** (+) V1 velocity; clean swap path. (−) Stripe fees; provider swap will still require re-vaulting cards (known cost, documented for the commercialista discussion).

## ADR-011 — Agents are first-class workers with tiered autonomy

**Context.** Requirement: AI/agentic automation from day one across support, data collection, and data entry — not bolted on later. Uncontrolled agent writes to a hotel's operational data would be untrusted and unauditable.

**Decision.** Agents run in the worker as pg-boss jobs, act **only through the same typed domain commands as humans**, and are identified as actors (`agent:{name}`) in `domain_events`. Every agent has a declared autonomy tier:

| Tier | Meaning | Examples |
|---|---|---|
| T1 autonomous | Acts, logged | KB answers, discrepancy classification, document field extraction with high confidence |
| T2 propose-confirm | Drafts, human taps | Registration prefill below confidence threshold, exception resolutions, onboarding drafts, guest comms in sensitive cases |
| T3 human-only | Agent may summarize, never act | Anything fiscal, refunds above threshold, Alloggiati manual overrides |

Every run recorded in `agent_runs` (input, tool calls, output, confidence, cost, latency, outcome, review status). Each agent ships with a golden eval set run in CI.

**Consequences.** (+) Automation with a complete audit trail; autonomy can be widened per agent per property as evidence accumulates — the same graduation logic as ADR-001, applied to trust. (−) Tool surface must be built for every capability an agent needs (no shortcut DB access, ever); eval maintenance is ongoing work.

## ADR-012 — LLM provider abstraction with EU processing requirement

**Context.** EU residency is non-negotiable (D9); model landscape shifts quarterly; different tasks need different price/quality points.

**Decision.** `LlmProvider` interface in `packages/core`; per-agent model config (task-tiered: extraction vs conversation vs classification); providers/endpoints must satisfy the EU-processing requirement and appear in the sub-processor register before use. No agent references a vendor SDK directly.

**Consequences.** (+) Swappable, cost-tunable, residency-verifiable. (−) Thin abstraction tax; a capability matrix per provider must be kept current.

## ADR-013 — Guest journey is an evented state machine and the single source of stay truth

**Context.** Journey spans booking→departure across modules, channels, and (later) IoT triggers; scattered status flags rot.

**Decision.** `journey_states` transitions only via evented commands; all modules (voice, IoT, console, agents) are trigger sources into the same machine; Realtime projects state to the console.

**Consequences.** (+) New trigger sources (door events, agents) plug in without journey changes; zero-touch metric (G1) computable directly from events. (−) Discipline: no module may write journey state directly.

## ADR-014 — Reference implementations over blank-page design

**Context.** Strategy record 08: demand and UX patterns are already validated at competitor expense (Mews's funding scale; Slope's Italian-market fit). A solo team designing every surface from zero spends its scarcest resource on solved problems, and non-standard UX is a training cost for seasonal staff.

**Decision.** Every product surface names a reference implementation before build (mapping in 08 §3: Mews for booking flow, guest profiles, tier packaging, data-model narrative; Slope for terminology and preventivi; phone-transposed Mews Kiosk flows for check-in UX). Innovation budget is spent exclusively on the wedge (07 §4 moats). Deviating from a reference requires a stated wedge-tied reason in the PR/design note.

**Consequences.** (+) Design velocity; hotelier muscle-memory compatibility; staff productive within a shift (InnSyst's lesson). (−) Surfaces will look conventional — accepted; differentiation lives in the operating model, not the widgets.

**Legal boundary (binding).** References are studied at the level of *behavior and rationale*, never *expression*: no code inspection, no asset reuse, no copied UI/marketing text, no pixel-close visual imitation, no reuse of coined/distinctive names (generic industry terms are fine; distinctive tier or feature names get our own). Study uses public materials (sites, docs, published demos, review platforms); no trial accounts created for product dissection where ToS prohibit competitive analysis. Comparative claims in collateral must be truthful and verifiable (EU comparative-advertising rules — aligns with M6). Mandatory process per surface: **understand → validate for our buyer → re-derive and improve**, with a short design note recording the reference, the reasoning, and what we changed — this note is both the quality mechanism and the evidence of independent development. Policy to be reviewed once by IP counsel.

## ADR-015 — Pricing displayed in €/room/month equivalence

**Context.** The market compares in €/room/month (Mews ~€15–17 entry, Cloudbeds similar, InnSyst at the low end). Our hybrid model (D14) is economically sounder for this segment but incomparable as stated.

**Decision.** D14 unchanged in substance; every quote, report, and piece of collateral shows the computed per-room equivalence for that property alongside the hybrid breakdown.

**Consequences.** (+) Instant comparability, and the comparison flatters us (bundled ≈ €7–10/room vs stacked competitor totals including a separate communication layer). (−) Requires honest inclusion of expected percentage fees in the equivalence — the number shown must be the number billed, or M6 (trust architecture) is damaged.
