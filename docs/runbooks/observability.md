# Runbook — observability (OpenTelemetry, ADR-036)

Every service emits traces, metrics and logs over OTLP: `apps/web`,
`apps/api`, `apps/worker` and `apps/admin`. A test in `packages/telemetry`
fails if an app's entry point does not start it.

## What you get

**Traces: one guest message is one trace.**
1. The web request.
2. The web app's fetch to `apps/api`, which carries the trace context.
3. The api route.
4. The pg-boss job: the queue carries the trace context in the payload under
   `__trace`.
5. The model calls: `chat <model>` spans with GenAI attributes and token counts.
6. The outbound HTTP calls (OpenRouter, Twilio).

Next's own spans (rendering, route handlers, its fetches) are included for web
and admin.

**Metrics**

| Metric | Labels |
|---|---|
| `bookone.job.duration` / `bookone.job.runs` | job name, outcome |
| `gen_ai.client.operation.duration`, `gen_ai.client.token.usage` | model, task, token direction |
| `http.server.request.duration` (api) | route pattern, method, status |
| `http.client.request.duration` | all outbound fetches |

**Logs**
- pino JSON on stdout, as before, and the same lines as OTLP log records.
- A line written inside a span carries `trace_id` and `span_id`. In Grafana, a
  log line links to its trace.

## What you never get (ADR-036 §5)

- **Personal values in logs.** They are replaced with `[redacted]` before the
  line is written. The key list is `packages/telemetry/src/redact.ts`; add to
  it when a new personal field is logged.
- **Prompts, completions or message text in spans.** The AI SDK's own telemetry
  stays off, and the collector deletes the known content attributes anyway.
- **Secrets in URLs.** Stay-link tokens, payment intents and `token`/`code`
  query values are rewritten twice: before export (`scrub.ts`) and at the
  collector (`transform/scrub-urls`). Found by reading real traces: Next names
  its fetch spans after the full URL.

Checked on 2026-09-27 against real traces: a guest message's full trace contained
neither its text nor the stay token.

## Local

```bash
docker compose -f infra/otel/compose.local.yaml up -d
```

Add `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` to `.env` and restart
the four services. Grafana is at http://127.0.0.1:3300:
- Explore → Tempo: search `{ resource.service.name = "bookone-worker" }`.
- Loki: `{service_name="bookone-worker"}`.
- Prometheus: `bookone_job_duration_seconds_count`.

Without the endpoint, telemetry is off and nothing changes. That is also how CI
runs.

## Deployed

- **VM (`infra/vm/compose.yaml`):** every service sends to the `otel-collector`
  container, which applies `infra/otel/collector.yaml` and exports to
  `OTEL_BACKEND_ENDPOINT` with `OTEL_BACKEND_AUTHORIZATION`. That is Grafana
  Cloud's OTLP gateway in an EU region (SP-014), or a self-hosted stack.
- **GCP:** `otel_collector_endpoint` in `infra/gcp`.
- **Sampling:** every trace outside production, 10% in production
  (`parentbased_traceidratio`). Errors are kept by tail sampling once a
  production collector exists; not configured yet.

## Not done yet

- [ ] Phoenix for model spans (self-hosted). The collector gets a second traces
      pipeline filtered to `gen_ai.*` spans.
- [ ] Tail sampling that keeps error traces in production.
- [ ] Dashboards and alerts:
  - job failures;
  - queue latency against the plan's 60-second owner alert;
  - model error rate;
  - alerts to the owner's WhatsApp/Telegram (ADR-032 item 4).
- [ ] Database spans. `postgres.js` has no OpenTelemetry instrumentation; the
      job and request spans bound the time spent in queries.
