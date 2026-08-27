# ADR-011 — Agents are first-class workers with tiered autonomy

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Requirement: AI/agentic automation from day one across support, data collection, and data entry — not bolted on later. Uncontrolled agent writes to a hotel's operational data would be untrusted and unauditable.

**Decision.** Agents run in the worker as pg-boss jobs, act **only through the same typed domain commands as humans**, and are identified as actors (`agent:{name}`) in `domain_events`. Every agent has a declared autonomy tier:

| Tier | Meaning | Examples |
|---|---|---|
| T1 autonomous | Acts, logged | KB answers, discrepancy classification, document field extraction with high confidence |
| T2 propose-confirm | Drafts, human taps | Registration prefill below confidence threshold, exception resolutions, onboarding drafts, guest comms in sensitive cases |
| T3 human-only | Agent may summarize, never act | Anything fiscal, refunds above threshold, Alloggiati manual overrides |

Every run recorded in `agent_runs` (input, tool calls, output, confidence, cost, latency, outcome, review status). Each agent ships with a golden eval set run in CI.

**Consequences.** (+) Automation with a complete audit trail; autonomy can be widened per agent per property as evidence accumulates — the same graduation logic as ADR-001, applied to trust. (−) Tool surface must be built for every capability an agent needs (no shortcut DB access, ever); eval maintenance is ongoing work.
