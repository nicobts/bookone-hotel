# CLAUDE.md — BookOne Platform

Guest-journey-first hospitality platform for small independent hotels (IT/AT/SI). Multi-tenant. EU-resident data. The guest operates the hotel; the back office writes itself from guest actions; owners handle exceptions only.

## Read first, in order
1. `docs/00-PROJECT-OVERVIEW.md` — scope, decision register D1–D21, non-goals
2. `docs/03-ARCHITECTURE.md` — topology, schema, conventions (§10 = repo layout)
3. `docs/adr/` — ADR-001…039, one file each ([index](docs/adr/README.md)); **ADRs override anything conflicting in older annex documents**
4. `docs/01-PRD.md` + `docs/02-USER-STORIES.md` — what to build, acceptance criteria
5. `docs/04-IMPLEMENTATION-PLAN.md` — current sprint scope and DoD
6. `docs/06-AI-AGENT-LAYER.md` — agent roster, `agent_runs`, autonomy tiers
7. **Guest Desk (active scope):** `docs/11-inventory.md`, then the plan and WP specs in `docs/guest_desk_20260927/bookone-guest-desk-handoff/docs/` — see the Guest Desk section below for how they are amended

Historical/context docs live in `docs/annexes/` (technical annexes, Concierge workstream PRD/gameplan) and `docs/business/` (proposals, cost references). They inform but never override. Precedence: ADRs > docs/00–08 > annexes/business.

## Stack (ADR-034, ADR-004…006, D13)
- `apps/web` — Next.js App Router, shadcn/ui, Tailwind, next-intl (it/de/en/sl). Vercel fra1.
- `apps/worker` — **Persistent Node process. NEVER edge, NEVER serverless.** Our own EU container (self-hosted VM → Cloud Run, ADR-033). Jobs via **pg-boss** (not Redis/BullMQ — ADR-005); the client is `@bookone/adapters/pg-boss`.
- `apps/api` (ADR-034) — Hono on @hono/node-server: payment and provider webhooks, `/health*`, the bearer-token `/jobs/*` surface web calls, and the per-property feature gate. Answers and enqueues; persistent process, never edge or serverless. `apps/worker` runs pg-boss jobs only and has **no HTTP ingress**.
- `apps/admin` (Guest Desk WP0.8, ADR-031/034) — operator console + its admin API (server actions, each through `withAdminAudit` in `packages/core/src/admin`) in **one container of our own, Tailscale-only, never on a third-party platform**. Staff sign in to a separate Supabase Auth project; never imports tenant-app auth.
- Supabase EU (Frankfurt): Postgres + Auth + Storage. **Drizzle** for all domain access.
- `packages/core` — canonical domain: schema, types, event emitter, journey state machine, AuthorityMap router, policy engine, `LlmProvider`, adapter interfaces. **All domain logic lives here; neither app reimplements it.**
- `packages/adapters` — `MockEricsoftAdapter` (with failure injection) until real API access; real adapter must pass the mock's contract-test suite before swap (ADR-008).
- `packages/agents` — registry, runner (pg-boss consumer), typed tools, prompts, evals; Guest Desk adds `profiles/` and `router/` (ADR-021).

## Binding rules (CI-enforced where possible)
1. **External IDs are never keys.** Platform UUIDs everywhere; external systems attach via `external_refs` (ADR-001).
2. **Every mutation emits a `domain_events` row** with actor + origin (`platform|sync|reconciliation`).
3. **RLS on every client-reachable table**, scoped by `property_id`. Cross-tenant test suite is a merge gate. Service-role queries still scope explicitly (ADR-007).
4. **Journey state changes only via evented commands** on the state machine — no module writes `journey_states` directly (ADR-013).
5. **Agents act only through typed domain tools**, identified as `actor='agent:{name}'`, every run recorded in `agent_runs`. No direct DB access for agents, ever. Fiscal-adjacent tools do not exist (ADR-011).
6. **No fiscal-core code** (SDI, corrispettivi, night audit, invoice issuance) under any framing — gated by D11 until C1–C6 verified in writing.
7. **Facts from tools only** in anything guest-facing: no generated prices, dates, availability. Tools return pre-formed `phrase` fields (ADR-009 discipline).
8. **UI surfaces follow named reference implementations** (docs/08 §3); deviations need a wedge-tied reason in the PR. Patterns and conventions only — never copied code, assets, text, or coined names (ADR-014).
9. Migrations forward-only (Drizzle Kit); RLS policy SQL versioned in the same PR as schema changes.
10. Type flow: Drizzle schema → core types → Hono RPC → web. No hand-written duplicate types.

## CI gates (all merge-blocking)
typecheck · vitest (every P0 AC has a test) · RLS cross-tenant suite · migration check · agent eval suite

## Conventions and workflows
- `docs/conventions/` — coding standards, UI component sourcing and theming
- `docs/runbooks/rls-policies-map.md` — every policy, and when isolation was last verified **by query**
- `docs/runbooks/privacy.md` — data-subject requests, retention, the register; `backup-restore.md` and `load-test.md` carry the drill logs
- `.claude/skills/` — `add-table`, `add-ui-component`, `write-adr`: the sequences where skipping a step fails silently. Use them; they are not summaries of this file

## Current phase
Sprints 1–10 shipped (04-IMPLEMENTATION-PLAN §1 Phases A–D): engine, booking surface, payments behind a mock, the guest journey, Alloggiati behind a mock, in-stay messaging + express checkout, the attribution/report layer that **is** the invoice basis (D14), self-service onboarding, and E8 — the data map, export, erasure, retention jobs, the generated sub-processor register, a backup-restore drill and a load test on the booking path.

Everything left before GA is external or infrastructural, and none of it is a feature: the **pen test**, an **egress proxy** for the DNS-rebinding residue Sprint 9's SSRF fix left, a **PITR restore drill** on a real Supabase project, and the load test re-run against staging. `docs/runbooks/backup-restore.md` and `docs/runbooks/load-test.md` name each one as not-yet-done rather than leaving it implied.

**The data map is `packages/core/src/privacy/data-map.ts`.** Export, erasure and retention all read it, and a table missing from it fails a test. If a change touches what the platform stores, it changes the map in the same pull request.

Built-vs-decided, per ADR and per sprint: `docs/adr/IMPLEMENTATION-STATUS.md`. Read it before assuming something works — several things are ports with mocks behind them on purpose.

External decisions still blocking real deployment, all in 04 §0 and none of them code: a payment provider (ADR-010; Stripe account in progress), an Alloggiati channel (`docs/runbooks/alloggiati.md`) and an ESP. Each already has its port, its mock and the contract suite a real implementation must pass. No longer open: the LLM and vision provider (OpenRouter, ADR-029), and WhatsApp/SMS (Twilio, ADR-035). Twilio is built behind the notification port and a webhook in `apps/api`, but Meta Business verification and templates are still needed before a real property uses it (`docs/runbooks/whatsapp.md`).

## Environments
`local` (Supabase CLI, mock adapter, Stripe test) → `staging` (EU project, seeded demo property) → `prod` (EU, migrations via CI only).

**Residency (D9 as amended by ADR-029).** Everything that *stores* platform data is EU-resident: database, file storage (identity documents included), backups, logs, traces, job state — that part is not negotiable. Model and vision API *calls* may be processed outside the EU for development, testing and early production (OpenRouter initially), with zero data retention, no training on our data, a transfer mechanism (DPA/SCCs or DPF) and a sub-processor register entry stating non-EU processing. Whether model processing must become EU-only is reassessed at production with paying properties, on evidence, in a new ADR. Any new service — EU or not — goes in the sub-processor register first.

## When uncertain
Prefer the documented decision over cleverness. If a task seems to require violating a binding rule, stop and surface it — the answer is a new ADR in `docs/adr/` (use the `write-adr` skill), not a workaround.

## Guest Desk fork — active scope

Source: `docs/guest_desk_20260927/bookone-guest-desk-handoff/` (plan `docs/10-guest-desk-plan.md`, specs `docs/specs/WP*.md`). The handoff was written for a single-app layout; **ADR-019…029 and `docs/11-inventory.md` amend it, and win where they conflict** — e.g. a spec saying `src/agent/…`, `src/mcp/…`, `tenant_features` or `capture_sessions` means the monorepo equivalent the inventory names, not a new parallel structure.

### Scope
- Phase 0 = WP0.1–WP0.8 (plan §4; WP0.8 = admin console + ops baseline, parallel). One WP per session, one PR. Do not start a WP whose dependencies are not merged, and do not build Phase 1+ items unless the spec says so.
- **Phase 1 is approved on mocks only (owner, 2026-09-28)**, ahead of its gate: build WP1.x against mock and simulated adapters, never call an authority, never file in production. ADR-039 records the obligations model; `docs/runbooks/compliance.md` is the operating view.
- Touch only the spec's "Touches" list, translated through the inventory.

### Flags (ADR-019)
- The flag store is `entitlements` (`packages/core/src/onboarding/entitlements.ts`); `FEATURES` has one key per plan §2 row that exists in code. No second flag table, no per-customer code branches.
- Off means the property cannot reach the module: `requireFeature` → 404 on pages **and every server action**, worker `/jobs/*` 404 for that property, no per-property schedule, sweeps skip it, the runner refuses its agents and tools. Hiding a nav item is presentation, never the control.

### Runtime (ADR-021, 022, 023, 025, 029)
- One orchestrator per guest thread: **hard rules → routing → one profile**. Profiles are data in `packages/agents/src/profiles/*.json`, validated by `schema.ts` at boot; prompts in `packages/agents/src/prompts/`, never inline.
- Hard rules are code in `packages/agents/src/router/hard-rules.ts`, never prompt: money/refunds/compensation never T1 and need human approval; identity, legal status or compliance outcome never T1; unknown intent twice → T2 with transcript; emergency → emergency info, page a human, stop replying on that thread.
- **The model selects, tools speak (ADR-022):** a model may pick the profile and the tool and fill its arguments; what the guest reads is the tool's `phrase` or a fixed profile template. Rule 7 and the tool-boundary audit are unchanged.
- The Vercel AI SDK lives only inside `@bookone/core/llm` behind `LlmProvider`; provider = configuration (OpenRouter initially, ADR-029), `small` and `strong` tiers per profile. No agent framework, no MCP server, no workflow engine (state columns + pg-boss until ADR-025's triggers fire).
- Tools stay in-process in `packages/agents/src/tools/` with a zod input schema each; the profile's `tools[]` is the grant, checked by the runner. `approvalRequired` tools are recorded as pending and run only after a human approves.
- Every tool call is recorded with profile, tool, input, output and reversibility (`agent_runs` today; the per-action log with `reversed_by` arrives in WP0.3/0.6).
- The owner back-office agent is a separate orchestrator bound to verified owner identities; a guest sender can never reach it.

### Data
- PII is redacted before anything reaches logs or traces.
- Identity-document images: private EU bucket, retention rule, deleted on schedule. **BookOne never asserts identity and does no biometric matching (ADR-027).**
- No Alloggiati, ISTAT or comune submission in Phase 0: the Alloggiati feature is off, and pre-arrival capture ends at `staff_confirmed` with a schedina preview.
- Until the transfer assessment covers it, demo OCR uses fixture or volunteer documents, not a real guest's (ADR-029).

### Tests and evals (ADR-024)
- Every WP adds unit tests for its logic and at least 5 replayable conversations under `packages/agents/src/evals/conversations/<wp>/`, run by the existing `test:evals` gate. Unsafe actions: zero.
- The demo property is seeded by `pnpm demo:seed` (`scripts/seed-demo.mts`), re-runnable, separate from `seed-dev.mjs`, touching only `demo-trieste`. Its knowledge base is `content/demo/kb.json`, which the WP0.5 golden eval also reads. No demo-mode toggle inside a real property.

### Stop and ask before
Adding a dependency · changing the router's hard rules · any schema migration · anything that moves money or touches Stripe live mode · storing or processing identity documents beyond the spec · enabling a feature for a real (non-demo) property · calling any external authority system.

### Admin console and ops (ADR-030…033)
- `apps/admin` holds the UI and the admin API together. The public worker gets no admin routes. Every admin route runs staff auth, then a role check, then audit middleware; the browser never holds a service-role key.
- `admin_audit` is append-only (a trigger refuses UPDATE/DELETE/TRUNCATE; client roles hold no privilege on it); never write a migration that loosens that. Every mutation carries a reason. Mutating a property's bookings or payments is not an admin capability.
- No internal surface (admin, Phoenix, queue dashboards) gets a public ingress: Tailscale only.
- Secrets come from the secrets manager at runtime; never commit `.env` values; per-property credentials are envelope-encrypted.
- Webhooks verify signatures and are idempotent on the provider's event id.
- **OpenTelemetry in every service (ADR-036), traces + metrics + logs over OTLP to a collector.**
  - A new app starts `startTelemetry` from `@bookone/telemetry` at its entry point; a test fails if it doesn't.
  - Log through `createLogger`, which is redacted and trace-correlated, never `console`.
  - Put ids in spans, never contents: no names, phones, emails, message text, prompts or completions.
  - A new personal field that gets logged goes into `packages/telemetry/src/redact.ts`.
- IaC in `infra/` (OpenTofu), two targets (`vm`, `gcp`), same image. **`tofu`/`terraform` run from WSL only**, per the global rule.
- New services (Tailscale, Infisical, Grafana, Phoenix, OCI/Hetzner, GCP, the staff Supabase project) get a sub-processor register entry before first use.

### Legal hygiene
Competitor behaviour may be referenced in design notes; competitor code, assets, UI copy and coined names are never used (rule 8). Each new surface gets a short design note in `docs/design-notes/` as evidence of independent development.
