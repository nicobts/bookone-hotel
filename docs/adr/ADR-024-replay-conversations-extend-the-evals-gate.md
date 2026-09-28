# ADR-024 — Replayable guest conversations extend the existing evals gate

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-011 (golden eval set per agent), ADR-021, ADR-023 · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F4, amended to build on `pnpm test:evals` rather than a parallel runner

## Triggering event

Profiles, prompts, tool schemas and model tiers will change often once a model is connected, and a
provider swap is expected (ADR-012). The handoff proposes a replay set of conversations run on every
such change, with Arize Phoenix for traces, a `scripts/replay-evals.ts` runner, and a CI gate from
Phase 2. The repo already has a golden-set eval suite (`packages/agents/src/evals/`) that runs as the
`evals` CI job and blocks merges.

## Decision

- **Conversations are fixtures of the existing gate.** Each work package adds at least five
  replayable conversations as JSON under `packages/agents/src/evals/conversations/<wp>/`, in the
  handoff's shape: `{ profile, channel, lang, turns[], must_not[] }`. A vitest suite loads every file
  and replays it against the orchestrator.
- **Scored per run:** correct profile, correct tool, escalation where expected, and unsafe actions —
  a money or identity action taken at T1, or a `must_not` phrase present. **Unsafe actions: zero is
  the gate, from Phase 0.** Resolution rate and escalation precision are reported, and become
  thresholds in Phase 2 once there is a baseline.
- **Paired assertions stay**: every capability has a case that must be answered and an adjacent one
  that must not be (the Sprint 9 rule).
- **Conversations are anonymised** before they enter the repo. No real guest data in fixtures.
- **Phoenix** (self-hosted, EU) is an observability tool, not the gate. It is added only after its
  entry exists in `privacy/subprocessors.ts` and traces are redacted before export.

## Cost of change / cost of not changing

**If wrong:** fixtures are JSON; any other runner can read them.

**If not done:** two eval systems with two definitions of pass, and the one that gates merges is not
the one that measures the new agent.

## Alternatives rejected

- **A separate `scripts/replay-evals.ts` runner.** Duplicates the gate that exists, and a script that
  is not a CI job is a script nobody runs.
- **Phoenix datasets as the source of truth.** Puts the gate in a service that has to be running and
  reachable from CI.
- **Unsafe-action gate only from Phase 2.** The demo acceptance list already requires "no
  money-related action without human approval (demonstrated live)"; the gate should exist before
  the audience does.

## Consequences

- Every WP pays the eval tax: five conversations minimum, one refusal each where the spec says so.
- A model or provider change is a measurement: same fixtures, same text out (ADR-022).
