# 06 — AI & Agent Layer: BookOne Platform V1

Agents are not a feature of the product; they are **how the product does its work**. This document defines the V1 agent roster, the pipeline infrastructure, guardrails, and where each agent lands in the sprint plan. Governing decisions: ADR-011 (tiered autonomy), ADR-012 (provider abstraction), ADR-013 (journey state machine as the shared workspace).

---

## 1. Design principles

1. **Agents use the same doors as humans.** Every agent action is a typed domain command → `domain_events` with `actor='agent:{name}'`. No direct DB writes, no privileged shortcuts. Auditability is what makes owner trust — and billing attribution — possible.
2. **Autonomy is earned per agent, per property.** Everything ships at the most conservative viable tier; tiers widen only with eval evidence and per-property owner consent. Same graduation logic as the data architecture.
3. **Facts come from tools.** The hard-tool-boundary rule from the voice concierge (ADR-009) applies to every agent: no invented prices, dates, availability, or legal statements. Extraction agents attach confidence and source spans.
4. **Cheap models for narrow tasks, strong models for conversation.** Task-tiered model config per agent via `LlmProvider`. Cost per run is recorded — agent COGS is a first-class metric.
5. **Every agent has an eval set before it has production traffic.** Golden sets live in the repo, run in CI, and grow from reviewed production runs.

## 2. Agent roster — V1

### AG-01 · Guest Concierge (chat) — Tier 1/2 · Sprint 7
The in-stay and pre-stay messaging brain (E3.2), shared tool surface with the voice workstream.
- **Automates:** availability/booking-status questions, KB answers, upsell offers, request intake → tasks.
- T1: KB answers, status lookups. T2: anything touching money or dates (proposes, guest confirms). T3: complaints with legal wording → staff with drafted reply.
- Tools: `get_availability`, `get_reservation`, `get_property_info`, `create_task`, `create_callback_ticket`, `escalate`.
- KPI: ≥55% conversations resolved without staff; tool-boundary audit = 0 violations.

### AG-02 · Document Extraction (data entry) — Tier 1→2 · Sprint 5
The "data entry from day one" workhorse. Reads uploaded ID documents (MRZ + visual zone), extracts registration fields, prefills the pre-arrival form.
- T1 when confidence ≥ threshold on all fields (guest still reviews on-screen — the guest is the confirming human); T2 flag to staff when below.
- Output schema is exactly the Alloggiati field set; every field carries confidence + source crop reference.
- KPI: ≥90% submissions with zero manual field entry; 100% guest-confirmed before staging.
- Spike (Sprint 5): LLM-vision extraction vs licensed MRZ SDK — decide on eval results against 50 real documents (privacy: eval on synthetic + consented samples only).

### AG-03 · Property Onboarding (data collection) — Tier 2 · Sprint 9, spike Sprint 3
Ingests the hotel's website, PDFs, menus, and policy documents → drafts the entire property configuration: KB entries, policies, room types, photos shortlist, i18n content in four languages.
- Always T2: owner reviews a diff-style proposal, accepts per section.
- This is what turns GA onboarding from 5 days toward hours — and it directly attacks the small-hotel support-economics trap (G5).
- KPI: ≥70% of KB/config accepted without edits at first review.

### AG-04 · Exception Triage — Tier 2 · Sprint 8
Reads the console exceptions inbox, classifies, prioritizes, and attaches a proposed one-tap resolution + drafted guest/staff communication to each item.
- T1 for classification/prioritization; T2 for resolutions and comms.
- KPI: median owner time-to-resolution ↓50% vs Sprint 7 baseline.

### AG-05 · Reconciliation Analyst — Tier 1/2 · Sprint 8
Classifies nightly discrepancies (rounding/timezone/logic), drafts explanations, links probable causes to recent sync events, proposes `explained` status.
- T1 classification; T2 status changes. Blocking-class discrepancies always page a human.
- KPI: ≥80% discrepancies auto-classified correctly (sampled review).

### AG-06 · Support Agent (owners & staff) — Tier 1/2 · Sprint 9
Answers "how do I…" questions about the platform itself, in-console and via WhatsApp, from versioned product docs; executes T2 guided actions ("set up my cancellation policy") by proposing the config change.
- Directly serves G5 (≤2 support contacts/property/month) — in this segment, **support cost is the business model**, and this agent is the margin defense.
- KPI: ≥70% support questions resolved without founder involvement.

### AG-07 · Attribution Auditor — Tier 1 · Sprint 8
Samples AI-attributed bookings weekly, verifies the evidence chain end-to-end, flags weak attributions **against our own interest** before the owner sees the report.
- KPI: 0 owner-discovered attribution defects. This agent exists because the report is the invoice (D14) — trust compounds, disputes don't.

### Deferred (P1/P2)
Review-response drafter (T2) · Rate-anomaly watchdog (read-only alerts; no rate authority in V1) · No-show chaser (T2 comms) · Housekeeping optimizer (needs Rooms data).

## 3. Pipeline infrastructure

```
packages/agents/
  registry.ts            // roster, tiers, model config, tool grants
  runner.ts              // pg-boss consumer: load agent → run → record
  tools/                 // typed tool implementations (domain commands only)
  evals/{agent}/         // golden sets + scoring, run in CI
  prompts/{agent}.md     // versioned system prompts
```

- **Trigger model:** agents subscribe to `domain_events` patterns or schedules via pg-boss (`agent.run` jobs). E.g. `documents.uploaded → AG-02`, `discrepancy.created → AG-05`, nightly `AG-07`.
- **`agent_runs` table:** `id, agent, property_id, trigger_event_id, input_ref, tool_calls jsonb, output jsonb, confidence, tier_applied, outcome(accepted|edited|rejected|auto), reviewed_by, cost_cents, latency_ms, model, at`.
- **Provider layer:** `LlmProvider` (ADR-012) with task-tiered model config; EU-processing verified per provider before registration; cost recorded per run. Anthropic API is the reference implementation; nothing imports a vendor SDK outside the provider package.
- **Human-review surface:** T2 proposals render as diff-cards in the console (accept / edit / reject); outcomes feed back into `agent_runs.outcome` — which is the data that justifies widening a tier.

## 4. Guardrails & evaluation

| Guardrail | Mechanism |
|---|---|
| No unauthorized capability | Tool grants per agent in registry; runner refuses undeclared tools |
| No fiscal action, ever | Fiscal-adjacent commands are not implemented as tools (absence, not policy) |
| Tenant isolation | Agent context is property-scoped at the runner; cross-tenant tool calls impossible by construction |
| Prompt-injection from ingested content (websites, documents, guest messages) | Ingested text is data, never instructions: delimited, and tool grants cap blast radius regardless |
| Cost runaway | Per-agent per-property daily budget; breaker + alert |
| Drift | Weekly sampled human review per agent; eval set grows from failures; CI blocks prompt/model changes that regress golden sets |
| Privacy | Agent inputs respect the retention map; document crops deleted with their parents (E2.4) |

**Tier promotion rule:** an agent widens from T2→T1 on a capability only after ≥200 consecutive accepted-without-edit runs on that capability for that property class, and owner opt-in. Demotion is immediate on any material error.

## 5. Sprint integration (delta to 04-IMPLEMENTATION-PLAN)

| Sprint | Addition |
|---|---|
| 1 | `agent_runs` table + `packages/agents` scaffold + `LlmProvider` interface |
| 2 | Runner on pg-boss; first trivial agent (AG-05 classification on injected mock discrepancies) proves the loop end-to-end |
| 3 | AG-03 spike: ingest design partner's website → draft KB (feeds Sprint 3 theming/content with real data) |
| 5 | AG-02 build + extraction-vs-SDK eval on consented/synthetic set |
| 7 | AG-01 live on messaging (shared tools with voice WS-B) |
| 8 | AG-04, AG-05 full, AG-07 |
| 9 | AG-03 productised into onboarding wizard; AG-06 on product docs |
| 10 | Agent pen-test scenarios (injection, cross-tenant attempts, budget breakers) in the external test scope |

No sprint gains scope weeks: AG-02 replaces the manual-entry UI polish that Sprint 5 would otherwise need, and AG-03/AG-06 are what make the Sprint 9 GA onboarding/support targets achievable at all. The agent layer is load-bearing for G1, G4 and G5 — remove it and those targets slip, which is the concrete meaning of "integrated from day one."

## 6. KPIs (added to PRD §3)

| Metric | Target |
|---|---|
| % journey data entered by humans (staff side) | ≤10% |
| Agent-resolved support share (AG-06) | ≥70% |
| T2 acceptance-without-edit rate (roster median) | ≥75% by GA |
| Agent COGS per stay | ≤€0.40 |
| Tool-boundary violations (all agents) | 0 |
