# ADR-025 — Long-running processes are state columns and pg-boss jobs until a named trigger fires

**Status:** Proposed (decided in Phase 1 with observed evidence) · **Date:** 2026-09-27
**Depends on:** ADR-005 (pg-boss), ADR-013 (journey state machine) · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F5

## Triggering event

Phase 1 introduces processes that span days: the schedina lifecycle with its 24-hour rule, daily
ISTAT returns including zero days, the monthly imposta period. These have waits, deadlines, retries
and, across adapters, compensation. The handoff raises whether a workflow engine is needed.

## Context

Phase 0 has no long-running process beyond pre-arrival capture, which is already a dimension of the
journey state machine (ADR-013) advanced by evented commands and swept by pg-boss jobs. That pattern
— state in Postgres, transitions evented, sweeps scheduled — already carries Alloggiati filing and
acknowledgement.

## Decision

Phase 1 starts with the existing pattern: a state table (or journey dimension), evented transitions,
pg-boss jobs and schedules. No engine.

Adopt one when **any** of these is observed, not predicted:

- more than about five wait points in one process;
- compensation logic spanning more than one adapter;
- "where is this obligation stuck, and why" needs more than one SQL query to answer.

Candidates, lightest first: Vercel Workflow (library, self-hostable), Mastra workflows (implies
revisiting ADR-023), Temporal (cluster or Temporal Cloud EU — D9 check first). The accepting record
states the observed pain, not a comparison.

## Cost of change / cost of not changing

**If wrong:** hand-built lifecycles are migrated into an engine; state already lives in Postgres,
so the migration is of control flow, not data.

**If not done:** an engine chosen before the first real process exists is chosen on features, and
is a new sub-processor or cluster to operate from day one.

## Alternatives rejected

- **Adopt an engine now.** No Phase 0 process needs it.
- **Never adopt one.** The triggers above are real failure modes of hand-built workflows.

## Consequences

- WP1.5 (deadline engine) is built on pg-boss and is the most likely place a trigger fires first.
