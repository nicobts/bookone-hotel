# 02 — User Stories: BookOne Platform V1

Stories are grouped by epic, ordered guest-first (D15). Priority: P0 = release-blocking for the gate indicated, P1 = should, P2 = later. Every P0 story has acceptance criteria (AC). IDs are stable for ticketing.

---

## EPIC E1 — Book & Pay (Module A · Gate: Alpha)

**E1.1 (P0)** As a guest, I want to see real availability and prices for my dates in my language, so that I can decide without emailing or calling.
- AC: dates+guests query returns options ≤1s (cache); prices show taxes/tourist-tax note; IT/DE/EN/SL switch persists; stale-source fallback shows request form, never guesses.

**E1.2 (P0)** As a guest, I want to complete a booking on my phone in a few steps, so that I don't abandon.
- AC: ≤4 steps; no account required; Apple/Google Pay via Stripe where available; confirmation screen + email/WhatsApp within 60s with booking reference; flow benchmarked against the named reference implementation (ADR-014) with deviations documented.

**E1.3 (P0)** As a guest, I want to pay a deposit or full amount securely, so that my booking is guaranteed.
- AC: SCA/3DS flow; card vaulted for no-show policy with explicit consent copy; failure returns to payment step with reason, booking held 30 min.

**E1.4 (P0)** As a guest, I want to cancel or change my booking within the policy, so that I don't have to call.
- AC: self-service link from confirmation; refund per policy computed and shown before confirm; change propagates to PMS reflection queue.

**E1.5 (P0)** As an owner, I want every engine booking to appear in Ericsoft, so that my current operation keeps working.
- AC: reflection ≤60s when connector live; queued+flagged when not; idempotent retries; exception surfaced with one-tap "mark handled manually".

**E1.6 (P1)** As an owner, I want engine prices to respect my seasonal rate table, so that direct never undercuts by mistake.
- AC: rates read from authoritative source; manual override log.

**E1.7 (P2)** As a guest, I want to book an upsell (late checkout, parking, dinner) during booking.

**E1.8 (P1)** As an owner, I want inquiries (email/WhatsApp/phone) turned into tracked quotes (*preventivi*) that the guest can accept into a booking, so that family/group business — the Italian market's core direct channel — stops living in my inbox. *(Reference: Slope's quote engine, per ADR-014; AI-drafted quotes are an AG-01/AG-02 extension; accepted quotes flow through the standard reservation path and are attribution-eligible.)*
- AC: quote from inquiry in ≤2 min (agent-drafted, T2 owner-confirmed); guest accept link converts to reservation with payment per policy; quote states validity window and auto-expires.

## EPIC E2 — Pre-arrival (Module B1–B2 · Gate: Beta)

**E2.1 (P0)** As a guest, I want to complete check-in online before arrival, so that I skip the desk.
- AC: link at T-48h via email/WhatsApp; document photo capture with guidance; all guests in party; resumable; ≤5 min median (measured).

**E2.2 (P0)** As a guest, I want to state my arrival time, so that the hotel is ready for me.
- AC: time feeds arrival-prep automation hook (HVAC/key issuance when Rooms present).

**E2.3 (P0)** As an owner, I want Alloggiati handled automatically from pre-arrival data, so that the daily chore disappears.
- AC: staged payload validated against schema; auto-submit on arrival confirmation; audit trail (payload, timestamp, receipt); alert at T-20h if unconfirmed; manual submit button always present.

**E2.4 (P0)** As a compliance-conscious owner, I want identity documents deleted after submission, so that I hold no unnecessary personal data.
- AC: hard delete post-acknowledgment; receipt retained; deletion evented in audit log.

**E2.5 (P1)** As a guest, I want to pre-order breakfast/dinner options, so that arrival is seamless. *(F&B hook — BookOne restaurant asset)*

## EPIC E3 — Arrival & Stay (Module B3–B4 · Gate: Beta)

**E3.1 (P0)** As a guest, I want my arrival confirmed without a desk stop, so that I go straight to my room.
- AC: arrival completes from door event (if Rooms) or guest tap or staff tap; only reservation-scoped triggers; completion posts PMS check-in, fires Alloggiati, sends welcome message with key/code info.

**E3.2 (P0)** As a guest, I want to message the hotel and get instant answers, so that I don't queue at the desk.
- AC: WhatsApp/webchat thread per stay; AI answers from KB+tools only (no invented facts — tool-boundary audit passes); human escalation per property routing; unanswered-escalation SLA alert.

**E3.3 (P0)** As a receptionist, I want escalated conversations with full context, so that the guest never repeats themselves.
- AC: handoff includes stay card + thread summary; takeover/return one-tap.

**E3.4 (P1)** As a guest, I want in-stay requests (towels, maintenance, taxi) to become tracked tasks, so that they don't get lost.

## EPIC E4 — Departure (Module B5 · Gate: Beta)

**E4.1 (P0)** As a guest, I want express checkout from my phone, so that I leave without queuing.
- AC: extras summary; Stripe settlement of platform-registered extras; invoice request routed to property/PMS (we issue nothing fiscal); review link after departure confirmed.

**E4.2 (P1)** As an owner, I want credentials revoked at checkout automatically. *(Rooms hook)*

## EPIC E5 — Owner Console (Module C · Gates: Alpha C1–C2, Beta C4)

**E5.1 (P0)** As an owner, I want an exceptions inbox as my home screen, so that I only touch what needs me.
- AC: exception types per PRD C1; each with resolution actions; zero-state reads "Nothing needs you"; push/WhatsApp notification per severity routing.

**E5.2 (P0)** As an owner, I want a Today view of arrivals/departures/in-house with journey state, so that I see the day at a glance.

**E5.3 (P0)** As an owner, I want to edit my property's knowledge and policies myself, so that changes are live without tickets.
- AC: KB editor (shared with concierge); versioned; live ≤60s.

**E5.4 (P0)** As an owner, I want a monthly revenue & fee report with evidence-linked AI attribution, so that I trust what I'm billed.
- AC: per D14; every attributed line drills to evidence; export PDF/CSV; dispute flag per line resolving owner-favorable.

**E5.5 (P1)** As a seasonal receptionist, I want role-limited access with zero training, so that I'm productive on day one.
- AC: staff role sees Today + exceptions only; all actions reversible or confirm-gated.

## EPIC E6 — Dual-source & Sync (Module D2 · Gate: Alpha engine, Beta reconciliation)

**E6.1 (P0)** As the platform, every entity has our UUID with external refs, so that autonomy is structurally possible (D10).
- AC: no external id used as key anywhere; lint rule/codegen guard on schema.

**E6.2 (P0)** As the platform, writes route by AuthorityMap per domain, so that integrated and autonomous properties run the same code.
- AC: booking domain `platform`; others `external` (or mock); unit tests cover both routes per domain.

**E6.3 (P0)** As an operator, I want nightly reconciliation with a discrepancy register, so that parity is measured, not assumed.
- AC: discrepancy classified (rounding/timezone/logic); trend chart; blocking-class discrepancy alerts.

**E6.4 (P1)** As an operator, I want shadow-mode dual-write per domain behind a flag, so that graduation evidence accumulates. *(Full use in Rung 5; engine ships now.)*

## EPIC E7 — Onboarding & Tenancy (Gate: GA)

**E7.1 (P0)** As the company, onboarding a property requires configuration only, so that GA means ≤5 days without engineering.
- AC: property setup wizard (identity, theming, policies, languages, payment account via Stripe Connect Standard, notification routing); seed checklist; demo-mode toggle.

**E7.2 (P0)** As the company, tenant isolation is enforced by RLS on every client-reachable table, so that a breach of one property never exposes another.
- AC: RLS policies reviewed per table; automated cross-tenant access test suite in CI; service-role usage inventoried.

**E7.3 (P1)** As the company, I want per-property feature entitlements, so that module pricing (D14) maps to flags.

## EPIC E8 — Compliance & Data (Gate: Beta)

**E8.1 (P0)** As a data subject, I can request export and erasure, so that GDPR rights are honored.
- AC: export bundle per guest identifier; erasure honoring legal retention carve-outs; both evented.

**E8.2 (P0)** As the company, retention jobs enforce the data map, so that we never hold more than declared.

**E8.3 (P0)** As the company, the sub-processor register is generated from config, so that contracts and reality never diverge.

---

## Story count summary

| Epic | P0 | P1 | P2 |
|---|---|---|---|
| E1 Book & Pay | 5 | 2 | 1 |
| E2 Pre-arrival | 4 | 1 | — |
| E3 Arrival & Stay | 3 | 1 | — |
| E4 Departure | 1 | 1 | — |
| E5 Console | 4 | 1 | — |
| E6 Dual-source | 3 | 1 | — |
| E7 Onboarding | 2 | 1 | — |
| E8 Compliance | 3 | — | — |
| **Total** | **25** | **8** | **1** |
