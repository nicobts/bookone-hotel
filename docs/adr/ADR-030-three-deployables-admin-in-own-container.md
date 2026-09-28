# ADR-030 — Three deployables: the admin console runs in its own container, never on a third-party platform

**Status:** Superseded by [ADR-034](ADR-034-api-split-from-worker.md) (deployable count; the admin decisions stand) · **Date:** 2026-09-27
**Depends on:** ADR-003 · **Supersedes:** ADR-003 (two deployables)
**Origin:** Guest Desk handoff ADR-F10 and ADR-F12, amended: `apps/web` stays on Vercel

## Triggering event

The Guest Desk plan adds an operator console (WP0.8) with the most sensitive capabilities in the product:
changing any property's features, pausing agents, reading any property's data as that property. ADR-003
allowed two deployables. The handoff proposed moving everything, including `apps/web`, into one container
set.

## Context

ADR-003 put the surfaces on Vercel fra1 and the worker on Fly/Hetzner EU, because serverless cannot hold
the worker's long-lived state. For the admin console, the question is not whether serverless can run it
but who can reach it. On a third-party platform the console is one misconfigured project setting away from
the public internet, and the platform's own staff and tooling sit between us and it.

## Decision

Three deployables, one database:

| Deployable | Runs on | Reachable from |
|---|---|---|
| `apps/web` — guest and console surfaces | Vercel fra1 (unchanged) | the internet |
| `apps/worker` — jobs, connectors, agents, public webhooks | our container (Fly/Hetzner EU → ADR-033) | the internet, webhooks and `/jobs/*` with bearer token only |
| `apps/admin` — operator console **and its API** | **our own container, never a third-party serverless platform** | **Tailscale only**; no public ingress |

- The worker's standing constraint is unchanged: persistent process, never edge, never serverless.
- `apps/admin` contains both the UI and the admin API (a Hono app calling `packages/core`) in one container.
  The public worker gets **no** admin routes.
- Shared logic still lives only in `packages/core`. No app reimplements domain logic.

## Cost of change / cost of not changing

**If wrong:** the admin container can move behind any other private ingress; its code does not depend on
where it runs.

**If not done:** either the admin API is mounted in the internet-facing worker, where one routing mistake
exposes it, or the console runs on a platform whose access model we do not control.

## Alternatives rejected

- **Everything in one container set, web included (handoff ADR-F12 as written).** Moves a working,
  registered surface for no user-facing gain. Vercel serves the guest pages well; the concern is the
  console, not the web app.
- **Admin API as a worker sub-app.** Fewer deployables, but admin routes would sit inside the process that
  accepts public webhooks.
- **Admin console on Vercel.** Third-party hosting for the most privileged surface we have.

## Consequences

- Three deploy targets. The admin container ships in the same image pipeline as the worker (ADR-033).
- ADR-003's reasoning about the worker stands and is restated here; ADR-003 is superseded only because its
  count is wrong now.
