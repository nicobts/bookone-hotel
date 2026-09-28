# @bookone/api

Hono on `@hono/node-server`. Provider webhooks, `/health*`, and the bearer-token
`/jobs/*` surface that `apps/web` calls (ADR-034). It answers and enqueues;
`apps/worker` runs the jobs.

## Standing constraint

A persistent Node process, never edge and never serverless (ADR-003, restated in
ADR-034). It holds a pg-boss client and, when WhatsApp and inbound email land,
the public webhook endpoints whose signature checks, rate limits and replay
protection must live in one place.

## What lives here

- `POST /webhooks/payments` — signature-checked, idempotent on redelivery
- `GET /health`, `/health/connector`, `/health/payments`
- `POST /jobs/*` — bearer token, then the per-property feature gate (ADR-019):
  a route whose feature the property lacks answers 404. Every route is
  classified in `src/features.ts`, and a test fails if one is not.

The exported `AppType` is what gives `apps/web` typed calls (binding rule 10).

## Configuration

`WORKER_URL` (in web) and `WORKER_INTERNAL_TOKEN` keep their pre-split names so
web's configuration did not change. Port `API_PORT`, default 8787 — the port the
worker used to listen on.
