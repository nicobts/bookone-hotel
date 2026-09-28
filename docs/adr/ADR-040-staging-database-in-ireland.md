# ADR-040 — The staging database runs in Ireland, and the app runs beside its database

**Status:** Accepted · **Date:** 2026-09-28
**Depends on:** ADR-006 (Supabase EU as managed Postgres) · **Amends:** ADR-006 (the "Frankfurt" in its title), `CLAUDE.md` (Stack: "Vercel fra1", "Supabase EU (Frankfurt)")

## Triggering event

The first cloud environment was created on 2026-09-28: `bookone-hotel-staging`, reference
`ohjpphsdmtcgdboreofq`, in its own BookOne Supabase organization. It came up in **`eu-west-1`
(Ireland)**, not `eu-central-1` (Frankfurt). A Supabase project cannot change region after
creation, and the owner chose to keep it rather than recreate it.

## Context

ADR-006 chose Supabase in the EU, and its title says Frankfurt. The requirement behind it is D9,
as amended by ADR-029: **every store of platform data is EU-resident**. Ireland meets that exactly
as Frankfurt does. The same provider holds the data under the same DPA.

What Frankfurt bought was co-location. The web app is set to deploy to Vercel `fra1`, and most
console pages make several database calls per request. A database in Dublin behind a Frankfurt web
app adds roughly 20–25 ms to every call.

## Decision

- **Any EU region is acceptable for a Supabase project.** EU residency is the rule; the city is not.
- **Staging is `eu-west-1`.**
- **The services that talk to a database run in the same area as it.**
  - Staging web: Vercel `dub1` (Dublin).
  - Staging `apps/api` and `apps/worker`: an EU-west host, when they are deployed.
- **Production's region is chosen when production is created**, with the same co-location rule. It
  is recorded in the sub-processor register and in the environment runbook at that point.

## Cost of change / cost of not changing

**If wrong:** recreating staging in Frankfurt is cheap. Migrations replay from zero in minutes and
the demo seeds itself. Only the project reference changes, in `.env.staging` and the CI variables.

**If not done:** staging is recreated in Frankfurt for a city that no requirement names. Or it is
kept in Ireland while the docs say Frankfurt, and a web app deployed per the docs pays cross-region
latency on every page.

## Alternatives rejected

- **Recreate staging in Frankfurt.** Possible, and cheap now. Rejected because nothing requires
  Frankfurt, and the owner preferred to keep the project the platform created.
- **Keep Vercel `fra1` with an Irish database.** The latency is paid on every request, for nothing.

## Consequences

- Residency is unchanged: the sub-processor register's Supabase entry covers EU regions.
- `docs/runbooks/staging.md` records the project, its region and how to reach it.
- When the web app is first deployed to staging, its Vercel region is `dub1`.
