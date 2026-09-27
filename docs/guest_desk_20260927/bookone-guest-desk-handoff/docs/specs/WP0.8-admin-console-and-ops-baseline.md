# WP0.8 — Admin console (minimal) and ops/security baseline
Depends on: WP0.1 · Est.: 5–7 days · Parallel with WP0.2–0.6

## Goal
A segregated operator console and the minimum ops baseline needed to run the demo and the first pilots safely.

## Build — admin console (ADR-F10)
- `apps/admin`: separate Next.js app, own domain, deployed as its own container. Not linked from the tenant app.
- Staff identity: separate IdP (Zitadel/Authentik self-hosted, or a dedicated Supabase Auth project). MFA mandatory, passkeys preferred. Staff and hotel users never share an identity store.
- Access: only via Tailscale (identity-aware). No public ingress. Same for Phoenix, Supabase Studio, queue dashboard.
- `apps/api/admin/*`: dedicated Hono admin API. Every route: staff auth → role check → audit middleware. The browser never receives a service-role key.
- `admin_audit` table: append-only (actor, action, target, reason, before, after, ip, ts); trigger forbids UPDATE/DELETE; daily export to immutable object storage.
- Screens (react-admin or Refine over the admin API): tenants (CRUD, status, region), feature flags with change history, kill switches (pause agent per tenant, global provider failover, token budget per tenant), health (queue depth, provider latency p50/p95, error rate, last successful job per type), view-as-tenant (read-only, time-boxed 30 min, reason required, logged, visible to the tenant in their settings), thread inspector with Phoenix deep-link.

## Build — ops baseline (ADR-F11 items due in Phase 0)
- Secrets: Infisical self-hosted (or GCP Secret Manager if the GCP project exists already); no secrets in env files committed anywhere; per-tenant secrets envelope-encrypted.
- Webhook hardening: Meta and Stripe signature verification, per-source rate limits, idempotent handlers keyed on provider event id.
- IaC skeleton: OpenTofu for the GCP project (Cloud Run services, Artifact Registry, Secret Manager, KMS, Cloud Armor policy) and for the OCI/Hetzner VM; CI pipeline builds signed images and can deploy to either target. Nothing must run on GCP yet.
- Backups: Supabase PITR enabled; VM volume snapshots nightly; `docs/ops/restore-drill.md` with a first drill executed.
- Observability: OpenTelemetry SDK wired in app, worker, admin; exporter to Phoenix (LLM spans) and to Grafana Cloud EU or self-hosted Loki/Tempo (everything else); uptime check on the webchat endpoint and the WhatsApp webhook; alert route to owner WhatsApp/Telegram.

## Touches
`apps/admin/**`, `apps/api/admin/**`, `admin_audit` schema, IaC folder, CI, otel bootstrap.
## Must not touch
Tenant-facing app, router, profiles, tools.

## Acceptance criteria
- [ ] Admin app unreachable from the public internet (test from outside Tailscale); reachable with staff MFA inside.
- [ ] Every mutating admin action produces one `admin_audit` row with a reason; UPDATE/DELETE on the table fail (test).
- [ ] Kill switch pauses a tenant's agent within 5 s; guests receive the profile-defined "reception will reply" message.
- [ ] Provider failover toggle switches the strong tier to the secondary provider with no code change.
- [ ] View-as-tenant expires automatically and appears in the tenant's audit view.
- [ ] Webhook with a bad signature is rejected and counted; replayed event id is ignored (tests).
- [ ] `tofu plan` for the GCP target is clean; CI can build and sign an image and deploy to the VM.
- [ ] Restore drill documented with timing.
## Stop and ask
Any admin capability that mutates tenant business data (bookings, payments) — not in this WP. Choice of IdP if not already decided.
