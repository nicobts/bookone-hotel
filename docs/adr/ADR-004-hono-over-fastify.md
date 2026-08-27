# ADR-004 — Hono over Fastify

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Both adequate; founder has active Hono production experience; Hono RPC gives end-to-end types to Next.js without codegen.

**Decision.** Hono on `@hono/node-server`. The edge-first temptation is explicitly rejected (see ADR-003).

**Consequences.** (+) Familiarity, shared types. (−) Slightly smaller Node-server ecosystem than Fastify; acceptable.
