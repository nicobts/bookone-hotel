# ADR-F2 — Per-tenant feature flags as the scope mechanism
Status: Accepted · Date: 2026-09-27

## Context
The existing build (Docs 00–09) contains modules outside the Guest Desk scope (Rooms/IoT, restaurant booking,
Ericsoft sync, fiscal core). Nothing is deleted.

## Decision
Every module is behind a per-tenant flag evaluated at route registration, job scheduling and agent tool registration.
Off means absent: no routes, no nav, no jobs, no tools. The flag set is the product configuration; there are no code
branches per customer. Flag matrix: `docs/10-guest-desk-plan.md` §2.

## Consequences
+ Pilots enabled selectively; demo tenant is exactly the Phase 0 surface.
− Flag plumbing must be audited in WP0.1; a leaking flag (hidden UI, still-registered tool) is a defect.
