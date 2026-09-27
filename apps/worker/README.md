# @bookone/worker

pg-boss jobs, schedules, connectors and the agent runner, in our own EU
container (ADR-033). **No HTTP ingress since ADR-034**: webhooks, health and the
`/jobs/*` surface web calls are `apps/api`'s; this process only consumes.

## Standing constraint (ADR-003 — do not relax without a superseding ADR)

> **This is a long-running, persistent Node process. It is never deployed to an
> edge runtime and never to serverless.**

Not a preference. Four things in here require a process that stays alive between
requests:

- **pg-boss polls** the job tables continuously (ADR-005)
- **connectors poll** the PMS on a per-property schedule (`availability.refresh`
  every 2–5 min)
- **warm PMS connections** — reconnecting per invocation is both slower and, on
  some vendor APIs, rate-limited
- **MQTT subscriptions** arrive with the Rooms module (Phase 2, D4 / Rung 4)

The edge-first temptation is explicitly rejected in ADR-004. If a change here
starts to look like it would run fine on a serverless function, that is a signal
the change belongs in `apps/web`'s route handlers instead.

## Responsibilities (03-ARCHITECTURE §1)

- pg-boss job execution: `availability.refresh`, `reservation.reflect`,
  `reconcile.nightly`, `agent.run`
- the dual-source sync engine and nightly reconciliation
- connectors: Ericsoft (mock until WS-C clears), WhatsApp,
  Alloggiati
- the agent runner from `@bookone/agents` — agents are jobs in this process, not
  a separate deployable
- notification fanout

**Stripe webhooks are the only authority on payment state** (received by `apps/api` since ADR-034; replay runs here) (03 §7.2) — no
polling, no optimistic state in the web app.

## Data access

Through `@bookone/core` only. The worker holds the service-role key, and
service-role is **not** a licence to write unscoped queries: every query scopes
by `property_id` explicitly, and CI attempts cross-tenant access per role as a
merge gate (ADR-007).

## Local development

```bash
pnpm --filter @bookone/worker dev     # tsx watch; no port — it only consumes
pnpm --filter @bookone/api dev        # the HTTP side, port 8787
curl localhost:8787/health
```
