# ADR-019 — Per-property feature flags are entitlements, gated where the property is known

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-007 (RLS), ADR-016 (property in the URL) · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F2 and the flagging half of ADR-F7, amended by the WP0.1 inventory (`docs/11-inventory.md` §2–3)

## Triggering event

The Guest Desk fork (`docs/guest_desk_20260927/…/docs/10-guest-desk-plan.md` §2) re-scopes the
product without deleting anything: every module is on or off per property, and the Phase 0 demo
property must expose exactly the Phase 0 surface. The handoff proposed a new `tenant_features`
table. The inventory found that Sprint 9 already built `entitlements` — per property, fail-closed,
evented, history kept — and that **nothing reads it**: `isEntitled` has no production caller.

## Context

Two things were on the table:

1. A new `tenant_features (tenant_id, feature_key, enabled, …)` table, as the handoff specified.
2. The existing `entitlements` table (`packages/core/src/onboarding/entitlements.ts`), whose
   `feature` column is free text constrained by a closed `FEATURES` list in code.

Separately, the handoff defined "off" as *no routes registered, no jobs scheduled, no tools
registered*. That definition assumes registration happens per tenant. Here it does not: one worker
process serves every property, Hono routes are one static chain (kept chained for `AppType`,
binding rule 10), the tenant arrives in the request body, and Next.js routes are file-system routes
fixed at build time. A route cannot be absent for one property and present for another in the same
process.

## Decision

**Entitlements are the flag mechanism.** `FEATURES` is widened to one key per row of the plan's §2
matrix. An entitlement row that is live means on; anything else — no row, an ended row — means off.
There is no second flag table and no `enabled` boolean.

**"Off" means the property cannot reach the module**, enforced at every point where the property is
known:

| Surface | Off means |
|---|---|
| Console pages, server actions, route handlers | `requireFeature` → `notFound()`, the same shape as `requireOwner` — in the layout, the page **and every action**, since each is its own request |
| Console nav | the item is not built for that property |
| Worker `/jobs/*` routes | 404 before any work, for the property in the body |
| Per-property schedules | not scheduled; the schedule loop re-syncs periodically so toggling needs no restart |
| Global sweeps | the sweep skips properties without the feature |
| Agents and tools | `runAgent` refuses an agent whose feature is off; `callTool` refuses a tool whose feature is off, and records the refusal |
| Outbound triggers (e.g. `arrival-confirm` → `alloggiati.file`) | the follow-on job is not enqueued |

A module is **globally absent** — no route, no handler — only when no deployment needs it, which is a
code decision, not a flag.

Out-of-scope modules are flagged, never deleted (ADR-F7). Where the plan names a module that does
not exist in this repo — restaurant booking — there is no key for it until there is code.

Toggling is a `grantEntitlement` / `revokeEntitlement` call under the service role. No redeploy.

## Cost of change / cost of not changing

**If wrong:** gating is a guard function at a known list of call sites plus one closed union type;
moving to another store means reimplementing `isEntitled`, not the call sites.

**If not done:** either two flag stores that drift, or a definition of "off" that the architecture
cannot meet, satisfied on paper by hiding nav items — which is the leak ADR-F2 names as a defect. The
repo already has one: `/jobs/payment-intent` and `/jobs/payment-simulate` are commented "never
registered" and are registered, returning 404 at runtime (`apps/worker/src/app.ts:597`, `:699`). It
is correct behaviour with a false comment, and false comments about absence are how a real leak gets
waved through review.

## Alternatives rejected

- **A new `tenant_features` table.** Duplicates `entitlements` and loses what it already has: rows
  are ended rather than flipped, so "never had it" and "had it until March" stay distinguishable,
  and every change emits a domain event.
- **Per-tenant route registration** (one Hono app per property, conditional chains). Breaks `AppType`
  inference for Hono RPC, and a process serving many properties still has to dispatch per request —
  it moves the check, it does not remove it.
- **Hide in the nav, enforce nowhere else.** Presentation is not permission; `app-sidebar.tsx`
  already says so about roles.
- **One process per property.** Rejected in ADR-F9 (margin, single data store).

## Consequences

- Test: with no entitlements, a property's nav is empty of modules, every gated `/jobs/*` call
  404s, no per-property schedule exists for it, every gated sweep skips it, and every gated tool
  call is refused. With the Phase 0 set, exactly the Phase 0 surface answers. Asserted as a list,
  not as "not empty".
- The fail-closed default means a gating bug turns a feature off, not on.
- `pnpm db:seed` grants nothing today; the demo seed grants the Phase 0 set explicitly.
- Enabling a feature for a real (non-demo) property stays a human action (Guest Desk stop-and-ask
  list).
