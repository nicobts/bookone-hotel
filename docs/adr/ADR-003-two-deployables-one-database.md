# ADR-003 — Two deployables, one database; worker is a persistent process

**Status:** Superseded by [ADR-030](ADR-030-three-deployables-admin-in-own-container.md) (a third deployable, the admin console) · **Date:** July 2026 (documentation handoff v1)

**Context.** Serverless request/response cannot hold PMS polling, queue workers, MQTT (Rooms), or long-lived connector state.

**Decision.** Next.js (Vercel fra1) for surfaces; Hono/Node worker (Fly/Hetzner EU) for jobs, connectors, sync, agents. Worker is never deployed to edge/serverless — stated in its README as a standing constraint.

**Consequences.** (+) Each half deploys on infrastructure suited to it. (−) Two deploy targets; shared logic must live in `packages/core` (enforced convention: neither app reimplements domain logic).
