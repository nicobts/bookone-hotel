# @bookone/agents

Agents are not a feature of the product; they are **how the product does its
work** (docs/06-AI-AGENT-LAYER.md). This package holds the roster, the runner,
the tool surface, the prompts and the eval sets. The agents themselves execute
inside `apps/worker` as pg-boss jobs — they are not a separate deployable, so
they share the worker's property-scoped context and the same typed domain
commands humans use.

## Layout (06 §3)

| Path                     | Owns                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `src/registry.ts`        | Roster AG-01…07: autonomy tier, model config, tool grants     |
| `src/runner.ts`          | pg-boss consumer — load agent, run, record into `agent_runs`  |
| `src/tools/`             | Typed domain commands. The only way an agent touches anything |
| `src/prompts/{agent}.md` | Versioned system prompts                                      |
| `src/evals/{agent}/`     | Golden sets + scoring, run in CI as a merge gate              |

## Standing constraints (ADR-011)

- **Agents use the same doors as humans.** Every action is a typed domain
  command that emits a `domain_events` row with `actor='agent:{name}'`. There is
  no direct database access for an agent, ever — not as an optimisation, not
  behind a flag.
- **Every run is recorded** in `agent_runs`: input, tool calls, output,
  confidence, tier applied, outcome, reviewer, cost, latency, model.
- **Tool grants are declared per agent** in the registry; the runner refuses any
  undeclared tool.
- **Fiscal-adjacent tools do not exist.** This is enforced by absence, not by
  policy (ADR-002 / D11).
- **Facts come from tools.** No generated prices, dates, availability or legal
  statements in anything guest-facing; tools return pre-formed `phrase` fields
  (ADR-009).
- **Ingested content is data, never instruction.** Websites, documents and guest
  messages are delimited on the way in; tool grants cap the blast radius anyway.
- **Tenant isolation by construction:** the runner scopes agent context to one
  property, so a cross-tenant tool call has no expressible form.
- **Autonomy is earned.** Everything ships at the most conservative viable tier.
  T2→T1 requires ≥200 consecutive accepted-without-edit runs on that capability
  for that property class plus owner opt-in; demotion is immediate on any
  material error.

## Scaffold status

`registry.ts` and `runner.ts` are stubs. Day-1 task 1 creates the structure and
the `agent_runs` slot in CI; the roster and the runner land with the schema
(task 2) and the pg-boss wiring (Sprint 2), where AG-05 discrepancy
classification proves the loop end-to-end.
