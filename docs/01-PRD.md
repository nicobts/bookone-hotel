# 01 — PRD: BookOne Platform V1

| | |
|---|---|
| Status | Draft v1 for build |
| Scope | Graduation Rungs 1–3 · IT market · IT/DE/EN/SL languages |
| Out of scope | See 00-PROJECT-OVERVIEW §6 |

---

## 1. Problem

Small independent hotels lose direct revenue to OTAs (15–25% commission) because their own booking and guest-communication surfaces are archaic, and they burn scarce staff hours on repetitive journey administration (registration, Alloggiati, key handling, routine questions). Incumbent PMS vendors are back-office-only: the guest never touches them, and the owner does all the typing.

## 2. Product thesis

Invert the model: **the guest operates the hotel.** Every guest action (book, pay, register, arrive, request, depart) writes the hotel's operational state as a side effect. Staff handle exceptions. The platform integrates with the existing PMS (dual-source, D10) so adoption requires no migration, and properties can graduate toward autonomy domain-by-domain.

## 3. Goals & success metrics

| # | Goal | Metric | V1 target |
|---|---|---|---|
| G1 | Zero-touch stays | % stays with no staff touchpoint | ≥40% (property with keypad locks: ≥60%) |
| G2 | Direct-revenue shift | Points of revenue mix moved OTA→direct | +5pt in 6 months per property |
| G3 | Registration automation | Alloggiati submissions requiring manual work | ≤5% |
| G4 | Adoption without migration | Onboarding time to first live booking | ≤5 working days, no code changes |
| G5 | Support economics | Support contacts per property per month | ≤2 after month 1 |
| G6 | Attribution integrity | AI-attributed bookings with complete evidence chain | 100% (it's the invoice basis, D14) |
| G7 | Agent-operated workload (06 §6) | Staff-entered journey data ≤10% · agent-resolved support ≥70% · T2 accept-without-edit ≥75% · agent COGS ≤€0.40/stay · tool-boundary violations = 0 | Per 06-AI-AGENT-LAYER |

**P1 backlog committed from the competitive scan (07 §3):** preventivi/quote engine (E1.8) · ISTAT + tourist-tax reporting module (Rung-3 adjacent) · accounting export for the commercialista (export-only, D11 untouched) · repeat-guest recognition · machine-readable availability endpoint for AI booking intermediaries.

## 4. Personas (from Doc #2 lineage)

- **The Guest** — books on mobile, speaks IT/DE/EN/SL, expects Booking.com-grade UX, wants to skip the desk.
- **Owner-operator ("Markus", 55, 45-room garni)** — decides alone, trusts numbers not features, checks phone at 23:00, hates his PMS.
- **Seasonal receptionist** — 6-month contract, minimal training time, must not need a manual.

## 5. Functional requirements

### Module A — Booking Engine (Rung 2, platform-authoritative, D12)

**A1. Public booking surface** per property: `book.{domain}/{property}` or embedded widget; property theming (logo, colors, photos); IT/DE/EN/SL via next-intl; mobile-first.
- AC: Lighthouse mobile ≥90; complete booking in ≤4 steps from landing; WCAG 2.1 AA on booking path.

**A2. Availability & rates display** — read from authoritative source per AuthorityMap (V1: Ericsoft via connector cache, refreshed ≤5 min; mock adapter until API access).
- AC: displayed availability never staler than 5 min; on connector failure surface shows request-form fallback, never wrong availability; every price shown carries `sourceSnapshotId`.

**A3. Reservation creation** — reservation is born in platform core (`origin='platform'`), then reflected to PMS via connector (write-through when connector live; queued with visible status when not).
- AC: reservation persisted with own UUID before any external call; PMS reflection retried with idempotency key; unreflected reservations visible in owner console exceptions within 60s.

**A4. Payments (Stripe)** — deposit or full prepay per property policy; SCA; card vaulting for no-show policy (Stripe Customer + SetupIntent; PCI SAQ-A — card data never touches our servers); refunds per cancellation policy.
- AC: 3DS challenge flow tested; webhook-driven state (no polling); every money movement linked to folio-lite entry.

**A5. Cancellation/modification self-service** per policy; changes propagate like A3.

### Module B — Guest Journey (Rung 3)

**B1. Pre-arrival flow** — T-48h link via email/SMS/WhatsApp: identity document capture (photo upload, guided), registration data for all guests, arrival time, upsell slots, deposit if unpaid.
- AC: completable in ≤5 min on mobile; documents encrypted at rest (Supabase Storage, EU); resumable; per-guest state machine `invited→started→submitted→validated`.

**B2. Alloggiati staging & submission** — validated data staged as Alloggiati payload; submitted automatically at arrival confirmation (or manually from console); full audit trail; identity documents deleted after acknowledged submission (retention: submission receipt only).
- AC: schema-validated payloads (checksum per Alloggiati spec); submission ≤24h from arrival 100% of cases with alerting at T-20h if unconfirmed; property remains legal owner (contract mirror).

**B3. Arrival completion** — event-driven: door event (when Rooms module present) or guest "I've arrived" tap or staff tap → confirms arrival → posts check-in to PMS (if connector) → triggers Alloggiati → welcome message → notifies housekeeping.
- AC: only reservation-scoped credentials/actions complete arrival; manual console override always available.

**B4. In-stay messaging** — WhatsApp/webchat thread per stay; answered by concierge AI (shared tool endpoints with WS-B) with escalation to staff; requests become tasks.
- AC: AI answers only from property KB + tools (hard tool boundaries per Concierge annex §6); escalation SLA configurable.

**B5. Departure** — express checkout: folio-lite summary, payment settlement of extras registered on platform, invoice request routed to PMS/property (we do not issue fiscal documents — D11), review request, credential revocation signal.

### Module C — Owner Console (exception surface, D15)

**C1. Exceptions inbox** — the home screen. Unreflected reservations, failed payments, pre-arrival not completed at T-12h, Alloggiati unconfirmed, escalated messages, reconciliation discrepancies. Each with one-tap resolution actions.
**C2. Today view** — arrivals/departures/in-house, journey state per stay.
**C3. Property settings** — policies, theming, languages, KB editor (shared with concierge), notification routing, AuthorityMap (read-only in V1 except booking domain).
**C4. Revenue & attribution report** — monthly: direct bookings via engine, AI-attributed bookings (evidence-linked), fees computed per D14. This report is the invoice basis.
- AC: every AI-attributed line links to its evidence (call/session id, timestamp, booking id); owner can drill to transcript/session.

### Module D — Platform foundation

**D1. Multi-tenancy** — all rows scoped by `property_id`; Supabase RLS enforced for every client-reachable table; service-role only in worker/server contexts.
**D2. Dual-source engine** — external_refs, AuthorityMap, append-only event log, sync jobs, nightly reconciliation with discrepancy register (per Piattaforma annex §2–4). V1 ships the engine with booking domain authoritative and Ericsoft domains synchronized (or mocked).
**D3. Auth** — Supabase Auth: email+password/OTP for owners/staff (roles: owner, staff); magic-link tokens for guest journeys (no guest accounts in V1).
**D4. Notifications** — WhatsApp Business API, email (Resend/SES EU), SMS fallback; per-property routing.
**D5. Observability** — structured logs, per-connector health, Sentry (EU region), job dashboard.
**D6. GDPR** — DPA-ready data map, retention jobs (documents post-submission; messages 24 mo; reservations 10 y fiscal-adjacent minimum — confirm with counsel), export & erasure endpoints.

## 6. Pricing model to instrument (D14)

| Component | Model | Instrumentation requirement |
|---|---|---|
| Platform base | €150–400/property/mo | Subscription record |
| Direct bookings | 2–4% capped | Fee computed per booking at confirmation |
| AI-attributed incremental | 8–12% | `attribution_events` with evidence chain |
| Modules (later) | €/room/mo | Entitlement flags |

Attribution rule V1 (conservative, contract-safe): a booking is AI-attributed only if it originates in a concierge call/chat session (session id present at reservation creation) **and** no engine session preceded it within 24h. Disputes resolve in the owner's favor.

**Display requirement (D20/ADR-015):** every quote, monthly report, and collateral shows the computed **€/room/month equivalence** for the specific property alongside the hybrid breakdown; the equivalence must include expected percentage fees (the number shown is the number billed).

## 7. Non-functional requirements

- **EU residency:** Supabase project in EU (Frankfurt); workers on Hetzner/Fly EU; storage EU; sub-processor register maintained (tier-2 EU-owned providers preferred where practical per prior stack doc).
- **Availability:** booking surface 99.9%; degraded modes defined (A2 fallback, B3 manual).
- **Performance:** booking API p95 <300ms (cache-served availability); console p95 <500ms.
- **Security:** RLS on all tenant tables; secrets in platform vault; document storage encrypted; pen test before third paying property.
- **Auditability:** every state change in event log with actor + origin (platform/sync/reconciliation).

## 8. Release gates

| Gate | Criteria |
|---|---|
| Alpha (design partner) | Modules A+C1–C2 live; mock connector acceptable; real payments in test mode |
| Beta (paying #1) | B1–B3 live; Alloggiati in production with audit; Stripe live; RLS pen-checked |
| GA (sellable, stranger property) | Onboarding ≤5 days without engineering; G5 support metric held for 30 days; attribution report accepted by two owners |

## 9. Open questions

1. Italian payment provider (Nexi/Axerve) — evaluate post-V1; Stripe ships V1 (D13). Owner-facing fee display must anticipate provider swap.
2. WhatsApp BSP selection (Twilio vs 360dialog) — decide Phase 1.
3. Alloggiati technical channel: direct web-service vs certified intermediary — legal/technical check before B2 build.
4. Guest document capture: build vs licensed SDK (e.g., ID scanning) — spike in Phase 2.
