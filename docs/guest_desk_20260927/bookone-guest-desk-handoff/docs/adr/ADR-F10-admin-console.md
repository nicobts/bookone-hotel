# ADR-F10 — Segregated admin console with its own identity and an audited admin API
Status: Accepted · Date: 2026-09-27

## Decision
A separate deployable (`apps/admin`) with a staff-only IdP (MFA/passkeys mandatory), reachable only through Tailscale
identity-aware access, talking to a dedicated admin API with audit middleware. Read-only by default; every mutation
carries a reason and lands in append-only `admin_audit`, exported daily to immutable storage. View-as-tenant is
time-boxed, logged and visible to the tenant. UI via react-admin/Refine over the admin API. Supabase Studio, Phoenix
and queue dashboards are behind the same access and are not support tools.
Scope grows by phase: Phase 0 tenants/flags/kill switches/health; Phase 1 compliance view, credentials vault,
provisioning workflow, GDPR export/erasure; Phase 2 Stripe Billing, cost per tenant, SLOs, Plane-linked support, status page.

## Consequences
+ Named, attributable operators — ISO 27001 evidence by construction; the support path does not touch the DB console.
− A second app to maintain; mitigated by generating UI from the admin API.
