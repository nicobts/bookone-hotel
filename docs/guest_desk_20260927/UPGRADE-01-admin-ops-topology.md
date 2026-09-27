# UPGRADE-01 — Admin console, ops baseline, hosting path, runtime topology

Paste this file into the repo (e.g. `docs/upgrades/UPGRADE-01.md`) and run one Claude Code session with:

> Read CLAUDE.md and docs/upgrades/UPGRADE-01.md. Apply every change in "Changes to apply" exactly: create the
> new files with the content given, append the given blocks to existing files, and make the listed edits.
> Do not implement any code. Open a PR titled "docs: UPGRADE-01 admin/ops/topology". Stop when done.

If the package already contains `WP0.8`, `ADR-F10`, `ADR-F11`, `ADR-F12` or the admin block in the CLAUDE.md
addendum, skip those items (they are identical) and apply only §5 (topology) and §6 (WP0.2 edit).

---

## Changes to apply

| # | Action | Path |
| --- | --- | --- |
| 1 | Create | `docs/specs/WP0.8-admin-console-and-ops-baseline.md` |
| 2 | Create | `docs/adr/ADR-F10-admin-console.md`, `ADR-F11-ops-security-baseline.md`, `ADR-F12-hosting-path.md`, `ADR-F13-runtime-topology.md` |
| 3 | Append | `CLAUDE.md` (the two blocks in §3) |
| 4 | Edit | `docs/10-guest-desk-plan.md`: add WP0.8 to §4 sequence; add §9c and §9d |
| 5 | Edit | `docs/specs/WP0.2-router-and-profiles.md`: replace the "Touches" line |
| 6 | Edit | `README-HANDOFF.md`: add the topology line under "Drop-in layout" |

---

## 1. New file — `docs/specs/WP0.8-admin-console-and-ops-baseline.md`

```markdown
# WP0.8 — Admin console (minimal) and ops/security baseline
Depends on: WP0.1 · Est.: 5–7 days · Parallel with WP0.2–0.6

## Goal
A segregated operator app and the minimum ops baseline needed to run the demo and the first pilots safely.

## Build — admin app (ADR-F10)
- `apps/admin`: separate Next.js app, own domain, own container. Not linked from the tenant app.
- Staff identity: separate IdP (Zitadel/Authentik self-hosted, or a dedicated Supabase Auth project). MFA mandatory,
  passkeys preferred. Staff and hotel users never share an identity store.
- Access: only via Tailscale (identity-aware). No public ingress. Same for Phoenix, Supabase Studio, queue dashboard.
- `apps/api` routes under `/admin/*`: staff auth → role check → audit middleware. The browser never holds a
  service-role key.
- `admin_audit` table: append-only (actor, action, target, reason, before, after, ip, ts); trigger forbids
  UPDATE/DELETE; daily export to immutable object storage.
- Screens (react-admin or Refine over the admin API): tenants (CRUD, status, region); feature flags with change
  history; kill switches (pause agent per tenant, global provider failover, token budget per tenant); health (queue
  depth, provider latency p50/p95, error rate, last successful job per type); view-as-tenant (read-only, 30-minute
  time box, reason required, logged, visible to the tenant); thread inspector with Phoenix deep-link.

## Build — ops baseline (ADR-F11 items due in Phase 0)
- Secrets: Infisical self-hosted (or GCP Secret Manager if the GCP project exists); nothing secret in committed files;
  per-tenant secrets envelope-encrypted.
- Webhook hardening: Meta and Stripe signature verification, per-source rate limits, idempotent handlers keyed on the
  provider event id.
- IaC skeleton: OpenTofu in `infra/` with two targets, `vm` and `gcp` (Cloud Run services, Artifact Registry, Secret
  Manager, KMS, Cloud Armor policy). CI builds signed images and can deploy to either target. Nothing must run on
  GCP yet.
- Backups: Supabase PITR enabled; VM volume snapshots nightly; `docs/ops/restore-drill.md` with a first drill executed.
- Observability: OpenTelemetry SDK in api, worker, web, admin; LLM spans to Phoenix, everything else to Grafana Cloud
  EU or self-hosted Loki/Tempo; uptime checks on webchat endpoint and WhatsApp webhook; alert route to owner
  WhatsApp/Telegram.

## Touches
`apps/admin/**`, `apps/api/src/admin/**`, `admin_audit` schema, `infra/**`, CI, otel bootstrap in every app.
## Must not touch
Tenant-facing web app, router, profiles, tools.

## Acceptance criteria
- [ ] Admin app unreachable from the public internet; reachable with staff MFA inside Tailscale.
- [ ] Every mutating admin action produces one `admin_audit` row with a reason; UPDATE/DELETE on the table fail (test).
- [ ] Kill switch pauses a tenant's agent within 5 s; guests receive the profile-defined "reception will reply" message.
- [ ] Provider failover toggle switches the strong tier to the secondary provider with no code change.
- [ ] View-as-tenant expires automatically and appears in the tenant's audit view.
- [ ] Bad-signature webhook rejected and counted; replayed event id ignored (tests).
- [ ] `tofu plan` for the `gcp` target is clean; CI builds, signs and deploys an image to the `vm` target.
- [ ] Restore drill documented with timing.
## Stop and ask
Any admin capability that mutates tenant business data (bookings, payments) — not in this WP. IdP choice if undecided.
```

## 2. New files — ADRs

### `docs/adr/ADR-F10-admin-console.md`
```markdown
# ADR-F10 — Segregated admin app with its own identity and an audited admin API
Status: Accepted · Date: 2026-09-27

## Decision
A separate deployable (`apps/admin`) with a staff-only IdP (MFA/passkeys mandatory), reachable only through Tailscale,
talking to `apps/api` `/admin/*` routes wrapped in staff auth, role check and audit middleware. Read-only by default;
every mutation carries a reason and lands in append-only `admin_audit`, exported daily to immutable storage.
View-as-tenant is time-boxed, logged and visible to the tenant. UI via react-admin/Refine over the admin API.
Supabase Studio, Phoenix and queue dashboards sit behind the same access and are not support tools.
Scope by phase — 0: tenants, flags, kill switches, health, view-as-tenant, thread inspector. 1: cross-tenant
compliance view, per-tenant credentials vault (KMS envelope), provisioning workflow (tenant → flags → WhatsApp number →
content → go-live checklist), offboarding (flags off, credentials revoked, GDPR export + erasure). 2: Stripe Billing
(subscriptions + metered check-ins; admin reads Stripe, never reimplements it), cost per tenant, SLO dashboard,
Plane-linked support tickets with thread ids, status page.

## Consequences
+ Named, attributable operators; support never touches the database console.
− A second app to maintain; mitigated by generating UI from the admin API.
```

### `docs/adr/ADR-F11-ops-security-baseline.md`
```markdown
# ADR-F11 — Ops and security baseline
Status: Accepted · Date: 2026-09-27

## Decision (priority order)
1 Zero-trust access for all internal surfaces via Tailscale · 2 Staff IdP with passkeys, separate from hotel users ·
3 Secrets in Secret Manager/Infisical; per-tenant credentials envelope-encrypted with KMS · 4 OpenTelemetry
everywhere; Phoenix for LLM spans, Grafana (Cloud EU or self-hosted) for infra/app; uptime checks; alerts to
WhatsApp/Telegram · 5 Webhook hardening (signature verification, rate limits, idempotency) · 6 Supabase PITR,
quarterly restore drill, written RPO/RTO · 7 dev/staging/prod, preview per PR, OpenTofu for GCP and VM from Phase 0 ·
8 Dependency scanning, SBOM, signed images · 9 Config as data with history (flags, model tiers, rate limits, prompt
versions) · 10 GDPR mechanics: retention jobs, per-tenant export/erasure, DPIA before Phase 1 production, records of
processing. Explicitly out: Kubernetes, service mesh, Backstage, data lake.

## Consequences
+ Audit-ready operations at solo scale. − Items 1, 3, 5, 7 are Phase 0 work (WP0.8); the rest land in Phases 1–2.
```

### `docs/adr/ADR-F12-hosting-path.md`
```markdown
# ADR-F12 — Self-hosted for Phase 0/demo; GCP at the first signed contract
Status: Accepted · Date: 2026-09-27

## Decision
Deployment unit is constant: containers web, admin, api, worker, phoenix + Supabase EU as managed Postgres.
Phase 0/demo: existing OCI instance or a Hetzner EU VM, Docker Compose, Tailscale, Infisical, nightly snapshots.
Guest data lives in Supabase EU throughout; the VM holds compute and caches only.
Trigger for GCP: first signed pilot or paying contract, whichever first. Target: Cloud Run europe-west (web, admin,
api, worker), Secret Manager + KMS, Artifact Registry with signed images, Cloud Armor on `api` webhook routes,
Vertex AI europe-west for models, all via OpenTofu. The GCP project, OpenTofu skeleton and CI deploy pipeline are
created in Phase 0 even if nothing runs there yet.
Rules: no pilot guest data on the self-hosted box without PITR and a completed restore drill; migration is a day if
container + IaC exist, a month if they do not.
```

### `docs/adr/ADR-F13-runtime-topology.md`
```markdown
# ADR-F13 — Runtime topology: web, admin, api, worker, phoenix
Status: Accepted · Date: 2026-09-27 · Related: ADR-F9, ADR-F10

## Decision
One monorepo, five deployables, shared packages.

| Deployable | Framework | Public | Responsibilities |
| --- | --- | --- | --- |
| apps/web | Next.js | yes | Tenant app: inbox, settings, guest capture page, webchat widget host. Frontend only; calls api with the hotel user's Supabase JWT. |
| apps/admin | Next.js | no (Tailscale) | Operator app; calls api with a staff-IdP JWT. |
| apps/api | Hono | webhooks only | The only backend: webhooks (WhatsApp, email inbound, Stripe) — the single public surface; REST for web and admin; the MCP server; synchronous agent runs (webchat streaming); enqueues everything else. |
| apps/worker | Node + pg-boss | no | Async agent turns (WhatsApp, email), reminders, retention, later compliance submissions and deadline engine. Same domain code as api; no HTTP ingress. |
| phoenix | container | no (Tailscale) | LLM traces and eval datasets. |

Packages: `packages/db` (Drizzle schema, RLS-aware client), `packages/domain` (policy, schedina, MRZ, tassa rules),
`packages/agent` (router, profiles, AI SDK runner), `packages/mcp-tools` (tool implementations, imported by api's
MCP server and by worker). web and admin import only types from these.

Trust model: api is the only deployable holding a database service role; web and admin are untrusted clients
authenticated by JWT; worker shares the service role but has no network ingress.

## Rationale
Webhooks need a stable endpoint independent of frontend deploys and framework request lifecycles; the MCP server is a
long-lived process with a tool registry; one place for signature verification, rate limits, Cloud Armor and audit
middleware; independent scaling on Cloud Run (webhook bursts → api, agent load → worker, UI → web).
Rejected: API routes inside Next.js (cold starts on webhooks, no long-lived MCP process, credentials in the frontend
runtime).
```

## 3. Append to `CLAUDE.md`

```markdown
## Runtime topology (ADR-F13)
- Five deployables: `apps/web`, `apps/admin`, `apps/api`, `apps/worker`, `phoenix`. Shared code only in `packages/*`.
- `apps/api` is the only backend and the only holder of a database service role. Webhooks, REST, the MCP server and
  synchronous agent runs live there. `apps/worker` runs pg-boss jobs and async agent turns; it has no HTTP ingress.
- `apps/web` and `apps/admin` are frontends: no service credentials, no direct database access, JWT to `api` only.
- Never add API routes to a Next.js app. Never import `packages/mcp-tools` or `packages/db` clients into web/admin.

## Admin app and ops (ADR-F10, F11, F12)
- `apps/admin` has its own IdP; it never imports tenant-app auth. It reaches data only through `apps/api` `/admin/*`
  routes, each wrapped in staff auth + role check + audit middleware.
- `admin_audit` is append-only; never write a migration that allows UPDATE/DELETE on it.
- No internal surface (admin, Phoenix, Studio, queue dashboard) gets a public ingress. Tailscale only.
- Secrets come from the secrets manager at runtime; never commit `.env` values; per-tenant credentials are
  envelope-encrypted, never stored in clear.
- All webhook handlers verify signatures and are idempotent on the provider's event id.
- Every deployable boots the OpenTelemetry SDK; LLM spans to Phoenix, everything else to the Grafana exporter.
- IaC lives in `infra/` (OpenTofu) with targets `vm` and `gcp`; the container images are identical for both.
```

## 4. Edits to `docs/10-guest-desk-plan.md`

**4a.** In §4, replace
`WP0.6 inbox → WP0.7 demo collateral.`
with
`WP0.6 inbox → WP0.7 demo collateral → WP0.8 admin app minimal + ops baseline (parallel).`

**4b.** Insert before `## 10. Risks (top)`:

```markdown
## 9c. Admin app, ops baseline, hosting (ADR-F10–F12)
Admin: separate app + staff IdP (MFA/passkeys) + Tailscale-only access + audited admin API. Phase 0: tenants, flags,
kill switches, health, view-as-tenant, thread inspector. Phase 1: compliance view, credentials vault, provisioning and
offboarding workflows, GDPR export/erasure. Phase 2: Stripe Billing, cost per tenant, SLOs, Plane-linked support,
status page.
Ops baseline: zero-trust access · staff IdP · secrets manager + KMS · OTel + Phoenix + Grafana · webhook hardening ·
PITR + restore drill · envs + OpenTofu · SBOM/signed images · config-as-data with history · GDPR mechanics.
Hosting: self-hosted VM (Compose, Tailscale, Infisical, snapshots) for Phase 0/demo; GCP Cloud Run europe-west at
the first signed contract; same containers, IaC and CI for both targets from Phase 0.

## 9d. Runtime topology (ADR-F13)
web (Next.js, public, tenant frontend) · admin (Next.js, Tailscale, operator frontend) · api (Hono; webhooks = the only
public surface; REST; MCP server; sync agent runs; only service-role holder) · worker (pg-boss; async agent turns and
jobs; no ingress) · phoenix (Tailscale). Packages: db, domain, agent, mcp-tools. Frontends hold no credentials and
talk to api by JWT only.
```

## 5. Edit to `docs/specs/WP0.2-router-and-profiles.md`

Replace the `## Touches` line with:

```markdown
## Touches
`packages/agent/**` (router, profiles loader, runner), `packages/mcp-tools/**` (stubs), `apps/api/src/mcp/**` (MCP
server), `apps/api/src/agent/**` (sync run endpoint), `apps/worker/src/agent-turn.ts` (async run job), `AgentAction`
schema in `packages/db`, `packages/agent/models.ts`, AG-01 entry point.
```

## 6. Edit to `README-HANDOFF.md`

Under "Drop-in layout", add the line:

```
Topology: apps/web · apps/admin · apps/api · apps/worker · phoenix — see docs/adr/ADR-F13-runtime-topology.md
```
