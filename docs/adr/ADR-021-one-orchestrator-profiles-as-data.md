# ADR-021 — Guest conversations run through one orchestrator routing to profiles defined as data

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-011 (agents as workers, tiered autonomy), ADR-019 (entitlements as flags) · **Supersedes:** nothing
**Amends:** docs/06-AI-AGENT-LAYER.md (AG-01 becomes the orchestrator's first consumer, not a monolith)
**Origin:** Guest Desk handoff ADR-F1, paths mapped to this monorepo

## Triggering event

Phase 0 needs seven distinct guest behaviours — pre-sale, booking support, payments, pre-arrival,
general info, checkout, complaints — each with its own tools and escalation policy, plus a read-only
owner agent. AG-01 today is one deterministic ladder in a `switch` (`packages/agents/src/runner.ts`);
adding seven behaviours to it would make the ladder the product.

## Context

Two designs were considered: autonomous agents that hand a conversation between themselves, or one
orchestrator that routes each guest turn to exactly one profile. The runner already enforces grants
(`ToolNotGrantedError`) and scopes every run to one property through `ToolContext`; either design has
to keep both.

## Decision

**One orchestrator per guest thread.** Each guest turn goes through, in order:

1. **Hard rules — code, never prompt**, in `packages/agents/src/router/hard-rules.ts`:
   - money, refunds, compensation → never T1; human approval required
   - statements about identity, legal status or a compliance outcome → never T1
   - unknown intent twice in a thread → T2 with transcript
   - emergency or safety keywords → emergency info, page a human, the agent stops on that thread
   The output is a tier decision, never text. Changing this list is a stop-and-ask.
2. **Routing** to one profile id; sticky per thread, switching only on a clear change of intent;
   unknown goes to `general-info` first and T2 the second time.
3. **Profile execution** with only that profile's tools.

**A profile is data:** `{ id, version, systemPromptFile, tools[], approvalRequired[], escalation[],
grounding, primaryAction, … }` in `packages/agents/src/profiles/*.json`, validated at boot against
`packages/agents/src/profiles/schema.ts` (zod). A malformed profile fails boot. Prompts live in
`packages/agents/src/prompts/`, never inline.

**The allow-list is the grant.** A profile's `tools[]` feeds the runner's existing grant check; a
tool not listed is refused and recorded, exactly as an ungranted tool is today. A tool whose feature
is off is refused too (ADR-019).

Profile boundaries follow tool sets, not topics. The **owner back-office agent** is a separate
orchestrator on a separate trigger (a verified owner identity per property), never a peer in a guest
thread; a guest sender can never reach it.

Every run is recorded in `agent_runs` as today, identified as `agent:{profile}` in `domain_events`.

## Cost of change / cost of not changing

**If wrong:** profiles are JSON and a router; collapsing back to one agent means one profile with
every tool, which the schema already allows.

**If not done:** AG-01's ladder absorbs payments and complaints, and the rule "money is never T1"
lives wherever the last contributor put it — possibly in a prompt, where it is a suggestion.

## Alternatives rejected

- **Multi-agent hand-off.** Emergent routing is exactly what cannot be audited or evaluated per
  behaviour, and an agent-to-agent hop is a second place for a money decision to slip through.
- **Hard rules in the system prompt.** A prompt is advice to a model; the rules above are
  obligations of the product.
- **Profiles as TypeScript objects.** Workable, but data files can be versioned, diffed and
  validated independently of code, and are the unit the eval set is scored against.

## Consequences

- The registry's static roster stays for the non-conversational agents (AG-03, AG-05, AG-07).
- Adding a behaviour means a profile, its tools and its evals — no emergent behaviour, by design.
- The same profiles serve voice later (ADR-009), because the tool surface is shared.
