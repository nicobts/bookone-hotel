# ADR-036 — Every service emits OpenTelemetry traces, metrics and logs

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-029 (storage EU), ADR-032 (ops baseline, item 4), ADR-033 (hosting), ADR-034 (api/worker split) · **Supersedes:** nothing
**Amends:** ADR-032 item 4. "OpenTelemetry in every service" becomes a binding requirement with the specifics below, and it is a merge rule for new services, not a Phase 0–1 aspiration.

## Triggering event

Four services now run (`apps/web`, `apps/api`, `apps/worker`, `apps/admin`),
and all they produce is pino lines on stdout. A guest message crosses three of
them: web, then api, then a worker job, then a model call, then a WhatsApp send.
When it goes wrong, nothing connects the steps. The owner asked on 2026-09-27
that every service expose OpenTelemetry for monitoring and logging, properly.

## Decision

1. **Every service emits all three signals over OTLP**: traces, metrics and
   logs. That is `apps/web`, `apps/api`, `apps/worker`, `apps/admin`, and any
   service added later.
   - Wiring lives in one package, `packages/telemetry`, and each service calls
     it first thing at startup. For the Next apps that is `instrumentation.ts`.
   - A service without it does not merge.

2. **Configuration is the OpenTelemetry standard environment, nothing custom.**
   - The variables are `OTEL_EXPORTER_OTLP_ENDPOINT`,
     `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` (defaulted per service)
     and `OTEL_RESOURCE_ATTRIBUTES`.
   - `deployment.environment` is local, staging or prod.
   - With no endpoint set, telemetry is off and the service runs unchanged. That
     is the local default, and CI does not need a collector.

3. **One collector in front of the backends.**
   - Services export to an OpenTelemetry Collector, never directly to a vendor.
     Swapping or adding a backend is then collector configuration, not a
     deploy.
   - Locally, `infra/otel` runs `grafana/otel-lgtm`: collector, Tempo, Loki,
     Prometheus and Grafana in one container.
   - On the VM, a collector container ships to the chosen backends.

4. **Backends store in the EU (D9 as amended by ADR-029).** Telemetry is stored
   platform data.
   - Grafana Cloud in an EU region, or the same stack self-hosted.
   - Phoenix for model spans, self-hosted on our host.
   - Each backend gets a register entry before first use.

5. **No personal data in telemetry.** It is stripped at the source and again at
   the collector.
   - **Spans and metrics** carry ids, never contents: `property.id`, the
     reservation and thread UUIDs, the job name, the model id, token counts,
     durations and outcomes. Never a name, phone, email, message text, prompt,
     completion, or document.
   - **Logs** go through pino's redaction for a fixed list of keys, which
     removes the value before a line is written. Every line carries `trace_id`
     and `span_id`, so a log line and its trace are one click apart.
   - **Model calls** follow the GenAI semantic conventions: `gen_ai.system`,
     `gen_ai.request.model` and usage counts. Prompt and completion content is
     not recorded; the collector drops those attributes even if a library adds
     them.

6. **What is traced, at minimum:**
   - every inbound HTTP request and outbound HTTP call (both automatic);
   - every pg-boss job, one span each with its name and property;
   - every model call;
   - every provider send (email, WhatsApp, SMS).

   Metrics cover job duration and failures by job name, model latency and token
   usage by tier, and HTTP server duration.

7. **Sampling.** Every trace is kept in local and staging. In production, 10% of
   successful traces are kept (`parentbased_traceidratio`), and errors are kept
   by the collector's tail sampling once there is a production collector.
   Metrics and logs are never sampled.

## Cost of change / cost of not changing

**If wrong:** OpenTelemetry is the vendor-neutral standard, and the collector
decouples backends from code. The main cost of reversal is removing one package
and four call sites.

**If not done:** an incident is diagnosed by reading four processes' stdout and
guessing which lines belong together. Nothing measures the plan's 60-second
owner-alert criterion, or the queue latency behind it.

## Alternatives rejected

- **Vendor SDKs (Sentry, Datadog agents).** Faster to start, but they tie code
  to a vendor, and the US-default ingestion of several vendors conflicts with
  D9 storage.
- **Logs only, with request ids.** Cheaper, but a request id does not follow a
  message across a queue. A trace context does.
- **`@vercel/otel` for the Next apps.** Fine on Vercel, but the operator
  console is not on Vercel, and one wiring package for four services keeps the
  redaction rules in one place.
- **Recording prompts and completions for debugging.** They contain guest
  messages. Debugging a conversation happens in the audit log (`agent_runs`,
  EU, access-controlled), not in a tracing backend.

## Consequences

- New dependency set, approved by the owner on 2026-09-27: `@opentelemetry/*`
  (API, Node SDK, OTLP HTTP exporters, the http/undici/pino instrumentations).
- Register entries: Grafana Labs (planned, EU region) and Phoenix (self-hosted,
  no sub-processor).
- The VM compose gains a collector; `infra/otel` holds the local stack and the
  collector configuration with the attribute-dropping rules.
