# ADR-F5 — Workflow engine: decided in Phase 1, not before
Status: Proposed (to be decided in Phase 1) · Date: 2026-09-27

## Context
Phase 0 has no long-running process beyond pre-arrival capture, which is a state column advanced by events.
Phase 1 introduces multi-day processes with waits, deadlines, retries and compensation (schedina lifecycle,
daily ISTAT, monthly tassa).

## Decision rule
Start Phase 1 with a Postgres state table + pg-boss jobs + cron, fully owned. Adopt an engine when any of:
more than ~5 wait points per process; compensation logic across adapters; "where is this obligation stuck and why"
needs more than a SQL query. Candidates, lightest to heaviest: Vercel Workflow (library, self-hostable),
Mastra workflows (implies adopting Mastra for layers 1–2 as well), Temporal (cluster or Temporal Cloud EU).
Write the final ADR with the observed pain, not a comparison article.
