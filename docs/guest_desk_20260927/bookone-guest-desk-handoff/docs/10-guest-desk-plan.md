# BookOne Guest Desk — phased plan (fork of the Docs 00–09 handoff)

As of 2026-09-27. Full narrative version with rationale lives in the project doc "BookOne v2 — Phased Plan"; this file is the
build-facing summary and the source of truth for scope, gates and acceptance criteria.

## 1. What changed
Re-sequencing, not a pivot. The guest-communication agent (existing Rung 1, Doc 09) ships first with a demo as its gate; the
statutory guest-registration core (Alloggiati Web, regional ISTAT, tassa di soggiorno) moves from deferred to Phase 1 with a
named region (FVG). Everything else in Docs 00–09 is preserved behind per-tenant flags (ADR-F2, ADR-F7).
Why it is safe for the thesis: the compliance step is the moment of guest-data capture — dual-source data ownership achieved
through the front door, without PMS integration.

## 2. Feature-flag matrix
| Module | Phase 0 | Phase 1 | Phase 2 | Later |
| --- | --- | --- | --- | --- |
| Communication Hub inbox (Doc 09) | ON | ON | ON | ON |
| Channel: webchat / email forwarding / WhatsApp | ON | ON | ON | ON |
| Channel: OTA messaging | OFF | OFF | ON | ON |
| Channel: voice | OFF | OFF | OFF | Phase 4 |
| Orchestrator + profiles (ADR-F1) | ON | ON | ON | ON |
| Guest profile / dual-source store | ON | ON | ON | ON |
| Ericsoft sync | per pilot | per pilot | per pilot | ON |
| Stripe Connect | ON (test) | ON | ON | ON |
| Booking engine / restaurant booking | OFF (hotel tenants) | OFF | per tenant | ON |
| Pre-arrival capture (new) | ON | ON | ON | ON |
| Alloggiati Web submission | OFF | ON | ON | ON |
| ISTAT regional adapter (WebTur FVG) | OFF | ON | ON | ON |
| Tassa di soggiorno engine | OFF | ON | ON | ON |
| Compliance dashboard | OFF | ON | ON | ON |
| Identity verification adapter (de visu) | OFF | OFF | OFF | Phase 3 |
| Rooms / IoT | OFF | OFF | OFF | deferred |
| Fiscal core (D11) | OFF | OFF | OFF | deferred |

## 3. Phases and gates
| Phase | Name | Est. | Gate to next |
| --- | --- | --- | --- |
| 0 | Demo | 4–6 wk | Association commits 5 named pilots + a letter to Regione FVG |
| 1 | Compliance Core FVG | 8–10 wk | 5 pilots filing Alloggiati + WebTur via BookOne for 30 days, no manual correction |
| 2 | Comms agent in production | 6–8 wk (overlaps 1) | ≥70% T1 auto-resolution on 3 pilots for 30 days; zero unsafe money actions |
| 3 | De visu (gated) | 4–6 wk | Viminale guidelines + written legal opinion |
| 4 | Voice | 8–12 wk | ≥6 months messaging data; Phase 2 metrics stable |
| — | Region expansion | 3–4 wk/region | Signed provincial convenzione |

## 4. Phase 0 — Demo
Scope: channels webchat + WhatsApp + email; one demo tenant with real content and seeded bookings; profiles pre-sale,
booking-support, payments, pre-arrival, general-info, checkout, complaints (each with one real action) + owner back-office
agent (read-only); pre-arrival capture with OCR/MRZ and schedina preview, no submission; unified inbox with T1/T2/T3 handoff,
audit log, reversal; scripted "I don't know → reception" moment; roadmap slide.
Non-goals: voice, OTA messaging, any authority submission, biometrics, channel manager, Rooms, open-web answers.
Work packages: WP0.1 inventory + flags → WP0.2 router + profiles → WP0.3 actions → WP0.4 pre-arrival capture (parallel) →
WP0.5 demo tenant + owner agent (parallel) → WP0.6 inbox → WP0.7 demo collateral → WP0.8 admin console minimal + ops baseline (parallel). Specs in `docs/specs/`.
Acceptance (all must be green):
- [ ] Profiles 1–7 and the owner agent complete their primary action end-to-end on WhatsApp and webchat, IT and EN.
- [ ] Every action in the audit log with actor, tool, input, result, reversibility.
- [ ] No money-related action without human approval (demonstrated live).
- [ ] Schedina preview correct from CIE, EU passport, non-EU passport.
- [ ] Handoff reaches the owner's phone ≤ 60 s and the agent stops on that thread.
- [ ] Demo runs from a clean tenant in < 20 min without a terminal.
- [ ] DPA template and guest privacy notice exist; notice shown on first contact.
Day-1 dependencies (human): Meta Business verification + WhatsApp display name + message templates; association intro;
DPA + privacy notice; OCR provider choice (EU); pilots' PMS list.

## 5. Phase 1 — Compliance Core FVG
Authority stack: Alloggiati Web (national, web service, 24h rule) → WebTur FVG (regional ISTAT C59, daily incl. zero days) →
Comune di Trieste (imposta di soggiorno rule table + declaration) → optional PMS write-back.
Work packages: WP1.1 adapter contract + lifecycle + region registry → WP1.2 AlloggiatiWeb → WP1.3 WebTurFVG → WP1.4 tassa
engine → WP1.5 deadline engine → WP1.6 dashboard + manual fallback → WP1.7 pilot runbook + monitoring.
Every adapter ships a manual fallback. Start the software-house registration and the Regione letter during Phase 0.
Acceptance: 5 pilots × 30 days through BookOne with no manual correction; evidence for every submission; zero missed 24h
deadlines; one full tassa period reconciled to the cent; fallback drill per adapter.

## 6. Phase 2 — Comms agent in production
WhatsApp verified in production; OTA messaging adapter; profiles post-stay and in-stay-requests; general-info gains allow-listed
search (official tourism, transport, weather, museums) with source line and KB caching; complaint SLA policies; owner mobile
handoff; eval harness as CI gate (ADR-F4); cost controls (token budget per tenant, model tiering).
Metrics (30 days): T1 auto-resolution ≥70%; median first response ≤30 s; escalation precision ≥80%; unsafe action rate 0;
owner interruptions −50% vs week 1; CSAT ≥4.3/5; cost per thread tracked with a ceiling.

## 7. Phase 3 — De visu (gated) · Phase 4 — Voice
Phase 3: `IdentityVerificationAdapter`, v1 staff-assisted live video (managed WebRTC, EU), consented recording, audit record;
BookOne never asserts identity (ADR-F6). Phase 4: isolated Python voice service (Pipecat or LiveKit Agents) behind SIP,
same profiles and MCP tools; entry criterion ≥6 months of messaging data.

## 8. Expansion
Region = one ISTAT adapter + one comune rule table + one provincial convenzione (ADR-F8). FVG → Veneto (ROSS1000) →
Trentino-Alto Adige → Lombardia (Turismo5). National approach only after three regions live.

## 9. Runtime stack by layer (ADR-F9)
1 Model I/O: Vercel AI SDK · 2 Loop: AI SDK multi-step, bounded · 3 Policy: own router + profiles as data · 4 Tools: MCP
server · 5 State: Supabase EU (RLS), pg-boss, no workflow engine until ADR-F5 · 6 Observability/evals: Arize Phoenix (EU) +
replay runner · 7 Channels: existing adapters. Models: two EU-resident tiers, provider = config. OCR: vision model + MRZ check
digits in TS. Deploy: one container set on one EU VM; Cloud Run when justified.
Rejected: Mastra (Phase 0), LangGraph.js, eve, Hermes (internal back-office only), one VM per hotel.

## 9c. Admin console, ops baseline, hosting (ADR-F10–F12)
Admin: separate app + staff IdP (MFA/passkeys) + Tailscale-only access + audited admin API; Phase 0 tenants/flags/kill
switches/health/view-as-tenant; Phase 1 compliance view, credentials vault, provisioning, GDPR export/erasure; Phase 2
Stripe Billing, cost per tenant, SLOs, Plane-linked support, status page.
Ops baseline: zero-trust access · staff IdP · secrets manager + KMS · OTel + Phoenix + Grafana · webhook hardening ·
PITR + restore drill · envs + OpenTofu · SBOM/signed images · config-as-data with history · GDPR mechanics.
Hosting: self-hosted VM (Compose, Tailscale, Infisical, snapshots) for Phase 0/demo; GCP Cloud Run europe-west at the
first signed contract; same container, IaC and CI for both targets from Phase 0.

## 10. Risks (top)
Meta verification delays demo · association interest is courtesy not commitment · WebTur has no spec · Alloggiati
registration slow · demo reads as "a chatbot" · unsafe action in front of an audience · biometric/GDPR exposure · solo capacity.

## 11. Open questions
Inventory result · pilots' PMS · which association level signs · existing legal opinion on digital de visu · WebTur interface ·
OCR provider · Italian product name · demo hotel in FVG?
