# BookOne Platform — Project Overview & Document Index

**Guest-journey-first hospitality platform with modular PMS graduation**

| | |
|---|---|
| Owner | Nicolas — RT Holding Group GmbH (AT) |
| Status | Development initiation — v1 |
| Date | July 2026 |
| Repo docs | `/docs` — this set is canonical; code follows docs |

---

## 1. What we are building (one paragraph)

A multi-tenant platform for small independent hotels (30–120 rooms, IT/AT/SI) that **automates the guest journey end-to-end** — booking, payment, pre-arrival registration, arrival, in-stay requests, departure — and, as a side effect of guest actions, writes the hotel's operational state. It integrates with the incumbent PMS (Ericsoft first) in **dual-source architecture**: our platform owns its data model from day one, the PMS is a synchronization source with per-domain authority, and properties graduate domain-by-domain toward full autonomy. The fiscal core (Rung 6) is explicitly gated and out of scope until conditions C1–C6 are met.

**Design north star:** *maximize the percentage of stays with zero staff touchpoints.* The owner console is an exception-handling surface, not a data-entry surface.

## 2. Document set

| # | Document | Purpose |
|---|---|---|
| 00 | This file | Index, scope, consolidated decisions |
| 01 | `01-PRD.md` | Product requirements, V1 scope, acceptance criteria |
| 02 | `02-USER-STORIES.md` | Epics and stories, guest-first, with AC |
| 03 | `03-ARCHITECTURE.md` | Stack, schema, dual-source implementation, security |
| 04 | `04-IMPLEMENTATION-PLAN.md` | Phases, sprints, DoD, environments, CI/CD |
| 05 | `05-ADRS.md` | Architecture Decision Records (ADR-001…013) |
| 06 | `06-AI-AGENT-LAYER.md` | Agent roster, pipeline infra, autonomy tiers, guardrails |
| 07 | `07-COMPETITIVE-ANALYSIS.md` | Market map, feature matrix, gap backlog, moat definition |
| 08 | `08-STRATEGY-REFERENCE-PLAYBOOK.md` | Strategy record: demand-cloning thesis, reference implementations, pricing language, endgame register |
| — | `ALLEGATO-TECNICO-Piattaforma-Dato-e-Graduazione.md` | Dual-source & graduation ladder (IT, canonical for D10–D12) |
| — | `PRD.md` (Concierge) + `GAMEPLAN-Concierge-*.md` | Voice concierge workstream (separate but shared platform) |
| — | `PROGETTO-IOT-BookOne-Rooms.md` + annex | Rooms/IoT workstream (Rung 4, later phase) |

## 3. V1 scope = Rungs 1–3 of the graduation ladder

| Rung | In V1 | Module |
|---|---|---|
| 1 | ✅ | Guest messaging + concierge tool endpoints (voice runs as its own workstream) |
| 2 | ✅ | **Direct booking engine + payments** — first platform-authoritative domain |
| 3 | ✅ | **Pre-arrival journey**: online check-in, document capture, Alloggiati staging/submission |
| 4 | ⏳ Phase 2 | Housekeeping, F&B, IoT arrival (docs exist; hooks only in V1) |
| 5 | ❌ | Rates/availability authority, channel manager |
| 6 | 🔒 Gated | Fiscal core — D11 conditions |

## 4. Consolidated decision register

| # | Decision | Source |
|---|---|---|
| D1 | Platform on top of PMS; no PMS build in V1 | Doc #1 / PMS cost ref |
| D2 | Owned by RT Holding Group GmbH | — |
| D3 | Ericsoft first; canonical model from commit one | Tech annexes |
| D4 | PMS access read-mostly; writes only where platform is authoritative | PRD |
| D5 | Conditional forwarding entry for voice; never the main line | Concierge PRD |
| D9 | EU data residency, no exceptions | All |
| **D10** | **Platform owns its data model day one; external PMS = sync source with per-domain authority** | Piattaforma annex |
| **D11** | **Fiscal core gated behind C1–C6 (≥25 properties at Rung 5, 6-month shadow parity incl. year-end close, compliance hire, revenue-funded, insurance, written revision)** | Piattaforma annex |
| D12 | Direct booking engine is the first platform-authoritative domain | Piattaforma annex |
| **D13** | Stack: Next.js App Router + shadcn/ui + Tailwind + next-intl · Supabase (Postgres EU, Auth, Storage) · Drizzle · persistent worker service (Hono/Node) · pg-boss for jobs · Stripe for payments V1 | 03-ARCHITECTURE |
| **D14** | Billing: base fee €150–400/mo + 2–4% on direct bookings (capped) + 8–12% on AI-attributed incremental revenue + per-room module fees. Attribution events instrumented from day one | PRD §Pricing |
| D15 | Guest-first inversion: every guest action writes hotel state; owner console = exceptions only | PRD |
| D16 | Small hotels only; B&B/vacation rentals deflected (Doc #1 boundary) | Doc #1 |
| **D17** | **Agents are first-class workers from day one: same typed domain commands as humans, tiered autonomy (T1/T2/T3), every run audited in `agent_runs`, eval sets in CI. Support, data collection, and data entry are agent-operated by default** | 06-AI-AGENT-LAYER / ADR-011 |
| **D18** | LLM access only via `LlmProvider` abstraction; EU-processing verified and sub-processor-registered per provider before use; per-run cost recorded | ADR-012 |
| **D19** | Reference-implementation policy: named reference per surface (Mews, Slope, et al.); blank-page design forbidden outside the wedge; deviations require a wedge-tied reason | 08 / ADR-014 |
| **D20** | All pricing communicated with €/room/month equivalence alongside the hybrid model | 08 / ADR-015 |
| **D21** | Endgame register maintained; investment tested against the compounding asset list | 08 §5 |

## 5. Workstreams and dependencies

```
WS-A  Platform core (this doc set)          ── independent start
WS-B  Voice concierge (existing gameplan)   ── shares tool endpoints + tenancy from WS-A
WS-C  Ericsoft connector                    ── BLOCKED on API approval (2–5 mo). Mock adapter until then
WS-D  Rooms/IoT                             ── Phase 2; blocked on lock survey (Fase 0)
```

**Week-1 external actions (calendar-critical, all already identified):**
1. File Ericsoft integration request (via a licensed property)
2. ElevenLabs Enterprise quote (EU residency)
3. Dograh multi-tenancy verification (one afternoon, Docker)
4. Collect 30–50 real front-desk call recordings
5. Lock survey at design-partner property (networked? keypad? Ericsoft-integrated?)

## 6. Non-goals for V1 (deflection list)

No channel manager. No OTA/marketplace ambitions (no demand generation). No rate management authority. No fiscal documents of any kind issued by us. No native mobile apps (responsive web + wallet passes). No B&B/vacation-rental adaptations. No multi-language beyond IT/DE/EN/SL. No revenue management. No hardware manufacturing. No Rung-6 work of any kind, including "just preparing it".
