# Sub-processor register

**Generated from `packages/core/src/privacy/subprocessors.ts`. Do not edit by hand** —
CI compares this file against the rendered output and fails when they differ.

D9, as amended by ADR-029: stored data stays in the EU, and no service, endpoint or
region — in the EU or not — is used without an entry here first. Model processing
outside the EU is the one recorded exception, and its entry says so.
Four entries below are `undecided` on purpose — the external decisions in 04 §0,
listed so this register describes the system as it is rather than as those decisions
would leave it.

## In use

### SP-001 — Supabase

**Purpose.** Managed Postgres, authentication and object storage — the primary data store.

**Processing region.** EU (Frankfurt, eu-central-1)

**Entity established in.** United States

**Categories of personal data.**

- guest identity and contact details
- reservation and stay records
- identity documents (transient, see the retention map)
- guest messages
- staff account records

**Contract.** Supabase DPA with SCCs; EU region pinned at project creation.

**Residency last verified.** 2026-08-29

ADR-006 records this as a tier-1 residency claim: an EU region operated by a US-owned provider. The exit path is plain Postgres — no proprietary features in the domain layer — and that is the mitigation, stated rather than implied.

### SP-002 — Vercel

**Purpose.** Hosting and edge delivery for the guest-facing web application.

**Processing region.** EU (fra1)

**Entity established in.** United States

**Categories of personal data.**

- IP addresses and request metadata
- form contents in transit (bookings, pre-arrival)

**Contract.** Vercel DPA with SCCs; functions pinned to fra1.

**Residency last verified.** 2026-08-29

Renders and forwards; stores nothing. The pinning is a deployment setting, which means it is a thing that can be changed by accident — 04 §3 makes the region part of the deploy checklist for that reason.

## Configured, not carrying production data

### SP-003 — Fly.io / Hetzner (EU)

**Purpose.** Hosting for the worker process — jobs, agents, scheduled work.

**Processing region.** EU

**Entity established in.** United States (Fly.io) / Germany (Hetzner)

**Categories of personal data.**

- everything the database holds, in memory during job execution

**Contract.** Not yet contracted for production. The choice between them is a cost and operations decision, not a residency one — both are EU-region capable.

**Residency last verified.** 2026-08-29

ADR-003. The worker is a persistent Node process and never serverless, which narrows the hosting choice more than residency does.

### SP-006 — OpenRouter

**Purpose.** Model gateway for the concierge orchestrator (intent routing, tool selection) and, from WP0.4, document OCR.

**Processing region.** Global routing; processing may be outside the EU (EU in-region routing available on Business/Enterprise)

**Entity established in.** United States

**Categories of personal data.**

- guest message text in transit
- booking facts passed as tool context
- identity-document images in transit (WP0.4, demo documents only until the transfer assessment covers it)

**Contract.** OpenRouter terms and DPA with SCCs; requests set zero data retention and deny data collection. Permitted by ADR-029 as a recorded exception to EU-only processing; storage stays in the EU.

**Residency last verified.** 2026-09-27

Enforced in code: `registerProvider` refuses a non-EU provider unless it cites ADR-029 and this entry exists. Reassessed at production with paying properties; moving to EU routing is a base-URL change.

## Not chosen — no data flowing

### SP-004 — Email service provider — undecided

**Purpose.** Transactional email: booking confirmations, pre-arrival invitations, escalation alerts.

**Processing region.** —

**Entity established in.** —

**Categories of personal data.** None — nothing is sent to this provider.

**Contract.** Blocked: 04 §0 item — an ESP that passes D9 residency has not been chosen.

**Residency last verified.** — (nothing to verify; no provider chosen)

The port exists and a mock sender is behind it. Nothing has ever been sent to a real address from this platform, and until an entry here says otherwise, nothing will be.

### SP-005 — SMS and WhatsApp Business Solution Provider — undecided

**Purpose.** Transactional SMS and WhatsApp messages to guests.

**Processing region.** —

**Entity established in.** —

**Categories of personal data.** None — nothing is sent to this provider.

**Contract.** Blocked: 04 §0 — WhatsApp BSP verification is not complete and no BSP is selected.

**Residency last verified.** — (nothing to verify; no provider chosen)

WhatsApp implies Meta as a further sub-processor whichever BSP is chosen. That has to be disclosed here as its own entry when the choice is made, not folded into the BSP’s line.

### SP-007 — Payment provider — undecided

**Purpose.** Card authorisation, deposits, refunds and payment-method vaulting.

**Processing region.** —

**Entity established in.** —

**Categories of personal data.** None — nothing is sent to this provider.

**Contract.** Blocked: ADR-010 and 04 §0 item 6. No provider is connected.

**Residency last verified.** — (nothing to verify; no provider chosen)

Card data would never reach our database in any case — the adapter deals in intents and references. The mock adapter marks every row `simulated` and the console says so on screen.

### SP-008 — Alloggiati channel — undecided

**Purpose.** Transmission of guest registration data to the Italian accommodated-persons registry.

**Processing region.** —

**Entity established in.** —

**Categories of personal data.** None — nothing is sent to this provider.

**Contract.** Blocked: 04 §0 item 5 — direct web service versus an intermediary is an open legal question.

**Residency last verified.** — (nothing to verify; no provider chosen)

An intermediary would be a sub-processor handling identity documents, which is the most sensitive flow in the product and the one where this register matters most. A direct integration with the Questura’s own service adds no sub-processor at all — the authority is a recipient, not a processor.
