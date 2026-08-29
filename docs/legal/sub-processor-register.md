# Sub-processor register

**Generated from `packages/core/src/privacy/subprocessors.ts`. Do not edit by hand** —
CI compares this file against the rendered output and fails when they differ.

D9 makes EU residency non-negotiable: no service, endpoint or region outside the EU
without an entry here first. Four entries below are `undecided` on purpose — they
are the external decisions in 04 §0, listed so this register describes the system
as it is rather than as those decisions would leave it.

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

### SP-006 — LLM provider — undecided

**Purpose.** Language model inference for the concierge and the extraction agents.

**Processing region.** —

**Entity established in.** —

**Categories of personal data.** None — nothing is sent to this provider.

**Contract.** Blocked: D18 and ADR-012 require verified EU processing and an entry here before a key is set.

**Residency last verified.** — (nothing to verify; no provider chosen)

Enforced in code: `registerProvider` refuses any provider whose register entry id is not found in this file. AG-01 currently runs as a deterministic router with no model behind it at all.

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
