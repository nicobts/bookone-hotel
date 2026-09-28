# WP0.1 — Codebase inventory and feature-flag plumbing
Depends on: — · Est.: 3–5 days · Session type: **read-only first**, then a small PR

## Goal
Know what exists. Produce `docs/11-inventory.md` mapping every row of the flag matrix (plan §2) to
exists / partial / missing, with file paths. Then implement per-tenant flags so OFF means dark (ADR-F2).

## Part A — inventory (no code changes)
For each §2 row: locate the module, note routes, jobs, agent tools, UI entry points, tables. Mark status.
List every place a module registers itself (router, job scheduler, tool registry, nav). Output the doc and STOP.
The human re-baselines the plan before Part B.

## Part B — flags
- `tenant_features` table (tenant_id, feature_key, enabled, updated_by, updated_at) + Drizzle schema + RLS.
- `features.ts`: typed feature keys matching §2 rows; `isEnabled(tenantId, key)` with request-scoped cache.
- Registration gates: routes, pg-boss job registration, MCP tool registration, nav all consult the flag.
- Demo tenant config with the Phase 0 ON set.

## Touches
`docs/11-inventory.md`, `src/config/features.ts`, schema + migration for `tenant_features`, registration points found in Part A.
## Must not touch
Business logic of any module; prompts; anything in Phase 1 scope.

## Acceptance criteria
- [ ] Inventory doc complete, every §2 row has a status and paths.
- [ ] With all flags OFF, the app boots with zero routes beyond auth/health, zero scheduled jobs, zero MCP tools registered (test asserts this).
- [ ] With the Phase 0 ON set, exactly the Phase 0 surfaces are registered (test asserts the list).
- [ ] Toggling a flag needs no redeploy.
## Tests
Registration-surface snapshot test for OFF and for Phase 0 ON.
## Stop and ask
Schema migration (required here — present it before applying). Any row where "partial" would mean a rewrite.
