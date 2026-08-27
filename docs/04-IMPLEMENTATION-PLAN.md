# 04 — Implementation Plan: BookOne Platform V1

Solo founder + Claude Code cadence. Sprints are 2 weeks. Estimates assume AI-assisted development on greenfield TypeScript (the favorable case), with the honest caveat that external calendars (Ericsoft approval, WhatsApp BSP verification, Alloggiati channel) are not compressible.

---

## 0. Week-1 external actions (before or alongside Sprint 1)

| # | Action | Why now |
|---|---|---|
| 1 | File Ericsoft API request via design-partner property | 2–5 month queue; longest pole |
| 2 | ElevenLabs Enterprise quote (EU residency) — WS-B | Decides voice path |
| 3 | Dograh multi-tenancy check (one afternoon) — WS-B | Second decision input |
| 4 | WhatsApp Business API application + BSP choice | Verification takes weeks |
| 5 | Alloggiati channel decision (direct WS vs intermediary) — legal check | Blocks Sprint 5 design |
| 6 | Stripe account + Connect Standard setup; commercialista session on fee flow | Blocks Sprint 3 live config |
| 7 | Collect design-partner assets: rates table, policies, photos, KB facts, 24-mo phone stats | Real data from Sprint 2 |

## 1. Sprint plan (10 sprints ≈ 20 weeks to GA)

### Phase A — Foundation (Sprints 1–2) → engine running

**Sprint 1 — Skeleton & tenancy**
- Monorepo scaffold (pnpm/turbo; apps/web, apps/worker, packages/core|adapters|i18n)
- Supabase EU project; Drizzle schema v1 (properties, guests, reservations, external_refs, domain_events); RLS baseline + CI cross-tenant test harness
- Auth (owner/staff roles); console shell with Today placeholder
- CI/CD: lint, typecheck, vitest, migrations, deploy staging (Vercel fra1 + Fly EU worker)
- **DoD:** two seeded properties; cross-tenant test suite green; event log receiving writes

**Sprint 2 — Dual-source engine + mock connector**
- AuthorityMap + write-router; PmsAdapter interface; **MockEricsoftAdapter** with failure injection
- pg-boss wiring; `availability.refresh`, `reservation.reflect` jobs; reflection exception surfacing
- Reconciliation skeleton (nightly run, discrepancy table, console list)
- **DoD:** reservation created in core reflects to mock ≤60s; injected failure appears in exceptions inbox with resolution action

### Phase B — Book & Pay (Sprints 3–4) → **Alpha gate**

**Sprint 3 — Booking surface**
- `/book/[property]`: availability display from rate_snapshots (mock-fed), 4-step flow, i18n four locales, theming
- Booking hold; reservation origin=platform; confirmation notifications (email first)
- **DoD:** E1.1, E1.2 AC pass on staging with design-partner theming and real rate table

**Sprint 4 — Payments & policies**
- Stripe: PaymentIntent + SetupIntent vaulting, webhooks in worker as state authority; policy engine (deposit %, cancellation windows); self-service cancel/change (E1.4)
- Fee computation: `fee_events` on confirmation (D14 direct %)
- Console C1 exceptions v1 + C2 Today live
- **DoD:** full money path in test mode incl. 3DS, refund, and webhook-loss replay; **Alpha checklist signed with design partner; go live shadowing real bookings (manual re-entry period)**

### Phase C — Guest journey (Sprints 5–7) → **Beta gate**

**Sprint 5 — Pre-arrival & documents**
- `/stay/[token]` journey app; pre-arrival state machine; document capture to EU Storage; multi-guest party
- T-48h invitation automation (email/SMS; WhatsApp when BSP verified)
- **DoD:** E2.1, E2.2 AC; median completion ≤5 min measured with 5 test users

**Sprint 6 — Alloggiati**
- Payload builder + schema validation; chosen channel integration; audit trail; T-20h alerting; document deletion job post-receipt
- Contract mirror text for property responsibility (with counsel)
- **DoD:** E2.3, E2.4 AC in production against design partner's real credential; 10 consecutive real submissions clean

**Sprint 7 — Arrival, stay messaging, departure**
- Arrival completion triggers (guest tap + staff tap; door-event interface stub for Rooms); PMS check-in post via adapter; welcome flow
- Message threads + concierge tool endpoints (shared with WS-B); escalation routing; tool-boundary audit job
- Express checkout (extras settlement, review request)
- **DoD:** E3.1–E3.3, E4.1 AC; **Beta gate: first paying property live end-to-end**

### Phase D — Console depth & GA hardening (Sprints 8–10) → **GA gate**

**Sprint 8 — Attribution & reporting**
- attribution_events + conservative rule (PRD §6); monthly report C4 with evidence drill-down; export PDF/CSV; dispute flag
- Subscription records; fee invoice basis generation
- **DoD:** E5.4 AC; report reviewed and accepted by design partner as invoice basis

**Sprint 9 — Onboarding & self-service**
- Property setup wizard (E7.1); KB editor (E5.3, shared schema with concierge); staff role (E5.5); entitlement flags
- Docs: onboarding runbook; support macros; owner quick-start (IT/DE)
- **DoD:** a second property onboarded by a non-engineer following the runbook in ≤5 days

**Sprint 10 — Compliance, resilience, pen test**
- GDPR export/erasure endpoints + retention jobs (E8); sub-processor register generation; backup restore drill; load test booking path; external pen test + remediation
- **DoD:** GA checklist: all P0 AC green, G5 support metric held 30 days on Beta property, pen-test criticals closed

## 2. Workstream sync points

| When | WS-B Voice | WS-C Ericsoft | WS-D Rooms |
|---|---|---|---|
| Sprint 2 | Decision (quotes + Dograh check done) | Request filed | Lock survey done |
| Sprint 5–6 | First real calls (own gameplan wk 5–6) | If approved: real adapter replaces mock behind same interface + contract tests | — |
| Sprint 7 | Shares tool endpoints/messaging built here | Contract-test parity vs mock before swap | Door-event trigger interface frozen |
| Post-GA | Phase 2 | Shadow-mode domains begin | Fase 1 build per IoT plan |

**If Ericsoft approval hasn't arrived by Sprint 7:** Beta proceeds on mock+manual re-entry for reflection (the design partner already operates Ericsoft manually today — this is not a regression), and the real adapter lands whenever approval does. GA to *strangers* on Ericsoft properties waits for the real adapter; GA to properties on graduated booking domain does not.

## 3. Definition of Done (every sprint)

- All AC of committed P0 stories pass as automated tests (vitest) or scripted manual checks recorded in the sprint log
- RLS cross-tenant suite green; no new service-role query bypasses property scoping
- Every mutation emits domain_events (spot-check query in review)
- Migrations forward-only and applied to staging; no drift
- Sentry clean of new unhandled errors after 48h staging soak
- Docs touched: any interface change reflected in 03-ARCHITECTURE same PR

## 4. Estimates & budget

| Phase | Weeks | Focus |
|---|---|---|
| A Foundation | 4 | Engine + tenancy |
| B Book & Pay | 4 | Alpha |
| C Journey | 6 | Beta |
| D GA | 6 | Hardening |
| **Total** | **20** | — |

| Cost line | Range |
|---|---|
| Development (20 wks, founder + AI tooling; optional contractor sprints 5–7) | €0–25k cash (contractor) |
| Infra (Supabase, Vercel, Fly/Hetzner, Sentry, BSP) | €300–600/mo |
| Pen test | €8–15k |
| Legal (GDPR map, Alloggiati responsibility mirror, ToS) | €6–12k |
| Stripe/BSP variable | usage |
| **Cash to GA (excl. founder time)** | **€18k–55k** |

Consistent with the AI-layer path economics from the cost reference — and an order of magnitude under any PMS scenario, because Rungs 5–6 are excluded by design.

## 5. Top risks for this plan specifically

| Risk | Mitigation |
|---|---|
| Scope creep toward Rung 5/6 under owner enthusiasm | D11 gate; deflection list in 00-OVERVIEW §6; any exception = written decision revision |
| Alloggiati channel choice late | Week-1 action #5; Sprint 6 is the only sprint with a hard external dependency inside it |
| WhatsApp verification slower than expected | Email/SMS fallbacks are first-class from Sprint 3, WhatsApp additive |
| Solo-founder bus factor at Beta (real hotel live) | Runbooks from Sprint 9 pulled earlier for arrival/Alloggiati paths; on-call fallback = graceful degradation to manual desk flow, tested |
| Attribution disputes poison first invoices | Conservative rule + owner-favorable disputes (D14); review report together monthly for first quarter |
| Mock↔real adapter divergence | Contract test suite runs against both; real adapter must pass mock's suite before swap |

## 6. First actions for Claude Code (Sprint 1, day 1)

1. Scaffold monorepo per 03-ARCHITECTURE §10, **including `packages/agents` and the `agent_runs` table (06-AI-AGENT-LAYER §3, §5)**
2. Implement Drizzle schema v1 + RLS SQL + cross-tenant test harness
3. `packages/core`: domain types, event emitter, AuthorityMap router, **`LlmProvider` interface (ADR-012)** with unit tests
4. `packages/adapters`: PmsAdapter interface + MockEricsoftAdapter with failure injection
5. CI pipeline with five gates (types, tests, RLS suite, migration check, **agent eval suite**)

Sprint-by-sprint agent additions are defined in 06-AI-AGENT-LAYER §5 and are part of each sprint's committed scope, not optional extras.
