# ADR-F1 — One orchestrator, many profiles (no multi-agent in the guest conversation)
Status: Accepted · Date: 2026-09-27 · Supersedes: — · Related: AG-01, Doc 09

## Context
The Guest Desk scope needs distinct behaviours (pre-sale, booking, payments, pre-arrival, general-info, checkout,
complaints) with different tools and escalation policies. Two designs were considered: autonomous multi-agent, or a
single orchestrator routing to profiles.

## Decision
A single conversation orchestrator routes each guest turn to exactly one **profile**: a system prompt, an allow-listed
tool set, an escalation policy and grounding sources, defined as data (`src/agent/profiles/*.json`, validated by
`schema.ts`). Profiles share one conversation state, one guest record and one inbox thread. Hard rules are code in
the router and run before any profile: money/compensation → never T1; identity/legal statements → never T1; unknown
intent twice → T2 with transcript; emergency → emergency info + human page + stop.
Profile boundaries follow tool sets, not topics (general-info is one profile with two knowledge sources).
The owner back-office agent is a separate orchestrator on a separate trigger (verified owner numbers), never a peer
in the guest conversation.

## Consequences
+ Deterministic routing, cheap to debug, one audit trail per thread, evaluable per profile.
+ Same profiles and tools serve voice in Phase 4.
− Adding a behaviour means adding a profile and its tools; no emergent agent-to-agent behaviour (intended).
