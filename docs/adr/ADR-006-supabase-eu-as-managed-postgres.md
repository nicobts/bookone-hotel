# ADR-006 — Supabase (EU/Frankfurt) as managed Postgres + Auth + Storage

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Solo founder; EU residency mandatory; RLS-based tenancy planned anyway.

**Decision.** Supabase EU project. Drizzle as the ORM for all domain access; supabase-js only where Auth/Storage/Realtime require it.

**Consequences.** (+) Auth, RLS, encrypted storage, PITR bundled. (−) US-owned provider in EU region (tier-1 residency claim, documented in sub-processor register); exit path is plain Postgres — no Supabase-proprietary features in the domain layer.
