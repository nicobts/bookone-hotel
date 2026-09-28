# ADR-034 — Webhooks and internal endpoints move to `apps/api`; the worker runs jobs only

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-003, ADR-004, ADR-005, ADR-018, ADR-023 · **Supersedes:** ADR-030 (its deployable count; its admin decisions stand and are restated below)
**Origin:** Guest Desk UPGRADE-01, ADR-F13 (runtime topology). Partly adopted. What was rejected, and why, is below.

## Triggering event

UPGRADE-01 proposed five deployables: web, admin, api, worker and Phoenix. `apps/api` would be the only
backend, `apps/web` a JWT-only client, and an MCP server would run inside `apps/api`. The part of that
which fits this repo is real. Today the process that accepts Stripe webhooks, and soon Meta's, is also
the process that runs every pg-boss job. A webhook burst and a slow nightly reconciliation compete for one
event loop. A deploy of job code restarts the webhook endpoint. Signature checks, rate limits and Cloud
Armor have no single front door.

## Decision

| Deployable | Runs | Ingress |
|---|---|---|
| `apps/web` | Next.js on Vercel fra1. Guest and console surfaces; server-side access through `@bookone/core` with `withUser` (ADR-018) — **unchanged** | public |
| `apps/api` | Hono on `@hono/node-server`: **the payment webhook, future provider webhooks (Meta, inbound email), `/health*` and the bearer-token `/jobs/*` surface** — today's `apps/worker/src/app.ts`, moved | public (webhooks); `/jobs/*` bearer token |
| `apps/worker` | pg-boss handlers and schedules only — today's `jobs/`, the agent runner, connectors | **none** |
| `apps/admin` | operator UI and its admin API, one container (ADR-031) | Tailscale only |
| Phoenix | LLM traces and eval datasets (ADR-032) | Tailscale only |

- **`apps/api` enqueues and does quick synchronous work.** Anything slow goes to pg-boss for the worker. It
  keeps the Hono RPC `AppType` that `apps/web` consumes (binding rule 10), and it keeps the feature gate
  (ADR-019).
- **Both `apps/api` and `apps/worker` are persistent Node processes** — never edge, never serverless (ADR-003's
  constraint). They are our own containers (ADR-033).
- **Packages keep their names:** `core`, `adapters`, `agents`, `i18n`.
- **Tools stay in-process** in `packages/agents` (ADR-023). There is no MCP server; one is added when the
  voice service needs it.

## Cost of change / cost of not changing

**If wrong:** the split is a move of `app.ts` and its boot code into a new app. Folding them back is the
same move reversed.

**If not done:** webhook availability stays tied to job load and job deploys. The first WhatsApp burst
during a nightly run is how that would be discovered.

## Alternatives rejected

- **`apps/api` as the only backend, with `apps/web` a JWT-only client (F13 as written).** Every console
  page loader and server action would be rewritten as a REST call. So would the RLS path: ADR-018's
  `withUser` enforces isolation per signed-in user on the web server today, and a JWT-to-API hop would need
  the same thing rebuilt. That is weeks of migration with no Phase 0 demo value, and it would supersede
  ADR-018's web path and binding rule 10. Revisit if a second frontend needs the same backend.
- **An MCP server in `apps/api`.** Rejected in ADR-023 for Phase 0–2. There is still no consumer outside the
  process.
- **Admin routes under `apps/api` `/admin/*`.** They would put the most privileged routes on the one public
  deployable. The admin API stays inside `apps/admin`, behind Tailscale (ADR-031).
- **`apps/web` as a container (F12/F13).** Kept on Vercel (ADR-030's reasoning stands).
- **Renaming packages to `db`, `domain`, `agent`, `mcp-tools`.** The names differ and the boundaries are the
  same. Nearly thirty ADRs and CLAUDE.md cite the current ones.

## Consequences

- The move is its own small work package, done after WP0.2. WP0.8's webhook hardening then lands in
  `apps/api`.
- ADR-019's route classification (`ROUTE_FEATURE`) and its tests move with `app.ts`.
- The sub-processor register's hosting entry covers both containers.
