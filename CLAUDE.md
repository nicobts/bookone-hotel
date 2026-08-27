# CLAUDE.md — BookOne Platform

Guest-journey-first hospitality platform for small independent hotels (IT/AT/SI). Multi-tenant. EU-resident. The guest operates the hotel; the back office writes itself from guest actions; owners handle exceptions only.

## Read first, in order
1. `docs/00-PROJECT-OVERVIEW.md` — scope, decision register D1–D21, non-goals
2. `docs/03-ARCHITECTURE.md` — topology, schema, conventions (§10 = repo layout)
3. `docs/adr/` — 16 ADRs, one file each ([index](docs/adr/README.md)); **ADRs override anything conflicting in older annex documents**
4. `docs/01-PRD.md` + `docs/02-USER-STORIES.md` — what to build, acceptance criteria
5. `docs/04-IMPLEMENTATION-PLAN.md` — current sprint scope and DoD
6. `docs/06-AI-AGENT-LAYER.md` — agent roster, `agent_runs`, autonomy tiers

Historical/context docs live in `docs/annexes/` (technical annexes, Concierge workstream PRD/gameplan) and `docs/business/` (proposals, cost references). They inform but never override. Precedence: ADRs > docs/00–08 > annexes/business.

## Stack (ADR-003…006, D13)
- `apps/web` — Next.js App Router, shadcn/ui, Tailwind, next-intl (it/de/en/sl). Vercel fra1.
- `apps/worker` — **Hono on @hono/node-server. Persistent Node process. NEVER edge, NEVER serverless.** Fly/Hetzner EU. Jobs via **pg-boss** (not Redis/BullMQ — ADR-005).
- Supabase EU (Frankfurt): Postgres + Auth + Storage. **Drizzle** for all domain access.
- `packages/core` — canonical domain: schema, types, event emitter, journey state machine, AuthorityMap router, policy engine, `LlmProvider`, adapter interfaces. **All domain logic lives here; neither app reimplements it.**
- `packages/adapters` — `MockEricsoftAdapter` (with failure injection) until real API access; real adapter must pass the mock's contract-test suite before swap (ADR-008).
- `packages/agents` — registry, runner (pg-boss consumer), typed tools, prompts, evals.

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
- `.claude/skills/` — `add-table`, `add-ui-component`, `write-adr`: the sequences where skipping a step fails silently. Use them; they are not summaries of this file

## Current phase
Sprint 1 (04-IMPLEMENTATION-PLAN §1 Phase A): monorepo scaffold ✅, schema v1 + RLS + test harness, auth + console shell, core package (events, AuthorityMap router, LlmProvider), MockEricsoftAdapter, `agent_runs` + agents scaffold, CI with the five gates. Day-1 task list: 04 §6. Built-vs-decided: `docs/adr/IMPLEMENTATION-STATUS.md`.

## Environments
`local` (Supabase CLI, mock adapter, Stripe test) → `staging` (EU project, seeded demo property) → `prod` (EU, migrations via CI only). EU residency is non-negotiable (D9): no service, endpoint, or region outside the EU without updating the sub-processor register first.

## When uncertain
Prefer the documented decision over cleverness. If a task seems to require violating a binding rule, stop and surface it — the answer is a new ADR in `docs/adr/` (use the `write-adr` skill), not a workaround.
