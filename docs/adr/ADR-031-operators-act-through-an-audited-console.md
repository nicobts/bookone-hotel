# ADR-031 — BookOne operators act only through an audited console with its own identity store

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-017 (identity outside tenancy), ADR-019 (entitlements), ADR-030 (admin in its own container) · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F10, amended: the staff IdP is a separate Supabase Auth project, the admin API lives in `apps/admin`

## Triggering event

Granting features (ADR-019) is a service-role call with no UI. The runbook's answer is to run
`grantEntitlement` from a script. The Guest Desk plan adds operator actions: pausing an agent, switching a
model provider, inspecting a property's threads. Each of these is a support action on someone else's data,
and none has an owner, a reason or a record.

## Decision

**Identity.** BookOne staff sign in to a **separate Supabase Auth project** (EU), used only for staff. MFA
is mandatory and passkeys are preferred. Staff and hotel users never share an identity store, and the
admin app never imports the tenant app's auth.

**Access.** `apps/admin` is reachable only through Tailscale identity-aware access (ADR-030). The same
applies to Phoenix and queue dashboards. The production database dashboard is supabase.com, which cannot
sit behind Tailscale, so its control is SSO with MFA on the Supabase organisation. It is not a support tool.

**API.** Every admin route runs staff authentication, then a role check, then audit middleware. The
browser never holds a service-role key.

**Audit.** Every mutation carries a reason and writes one row to `admin_audit` (actor, action, target,
reason, before, after, ip, ts).
- The table is **append-only**: a trigger refuses UPDATE and DELETE. It follows the `add-table` skill (RLS,
  policy map) and the data map.
- It is exported daily to immutable storage.

**Read-only by default.**
- **View-as-tenant** is read-only, lasts 30 minutes, requires a reason, is logged, and is visible to the
  property in its own settings.
- Mutating a property's business data (bookings, payments) is not an admin capability.

**Scope by phase.**
- **Phase 0:** properties, features (entitlements), kill switches, health, view-as-tenant.
- **Phase 1:** compliance view, credentials vault, provisioning, GDPR export and erasure.
- **Phase 2:** billing, cost per property, SLOs, support links, status page.

**UI.** Built over the admin API, with shadcn/ui to match D13. If a framework such as Refine is used, it is
used headless. Adding any of it is a dependency sign-off.

## Cost of change / cost of not changing

**If wrong:** the identity store and the UI are replaceable behind the admin API; the audit table and its
rows are what must survive.

**If not done:** support happens in the database console, and "who changed this hotel's features and why"
has no answer. That is the first question in any ISO 27001 audit or due-diligence review, and the answer
cannot be reconstructed later.

## Alternatives rejected

- **Staff as a role in the hotel identity store.** One compromised tenant-side session policy would reach
  operator capabilities.
- **Zitadel or Authentik self-hosted.** A dedicated IdP is one more stateful service to run and back up,
  for no capability Phase 0 needs.
- **react-admin with its own design system.** A second visual language inside the product family, against
  D13.

## Consequences

- The second Supabase project gets its own entry in the sub-processor register (same vendor, separate
  project and DPA scope).
- Entitlement changes made from the console still go through `grantEntitlement` / `revokeEntitlement`, so
  each one emits its domain event as well as its `admin_audit` row.
