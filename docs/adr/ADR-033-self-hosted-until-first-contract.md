# ADR-033 — Our containers run self-hosted until the first signed contract, then on GCP Cloud Run

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-006 (Supabase EU), ADR-030 (three deployables), ADR-032 · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F12, amended: `apps/web` stays on Vercel (ADR-030)

## Triggering event

The Phase 0 demo needs somewhere to run the worker, the admin console and Phoenix. The first pilot needs
somewhere defensible in a customer's security review. Those are different requirements, and building for
the second from day one costs money the demo has not earned.

## Decision

**The deployment unit is constant.** It is one container set — `worker`, `admin`, Phoenix — plus Supabase
EU as managed Postgres, and `apps/web` on Vercel (ADR-030). Guest data lives in Supabase EU throughout.
The container hosts compute and caches only.

**Phase 0 and the demo** run on a self-hosted EU VM: the existing OCI instance (in an EU region) or a
Hetzner EU VM. It uses Docker Compose, Tailscale, Infisical and nightly snapshots.

**At the first signed pilot or paying contract, whichever comes first,** the container set moves to GCP:
- Cloud Run in europe-west for worker and admin;
- Secret Manager and KMS;
- Artifact Registry with signed images;
- Cloud Armor in front of the webhook endpoints;
- everything defined in OpenTofu.

Model endpoints follow ADR-029 at that point: OpenRouter, or Vertex AI europe-west if the reassessment
chooses EU-only processing.

**Prepared in Phase 0, even though nothing runs on GCP yet:** the GCP project, the OpenTofu skeleton for
both targets, and a CI pipeline that builds a signed image and can deploy to either target.

**Rule:** no pilot guest data on the self-hosted VM without working backups and a completed restore drill.

## Cost of change / cost of not changing

**If wrong:** the migration takes a day if the container and the IaC exist, and a month if they do not.
That is why both are Phase 0 work.

**If not done:** either the demo waits for cloud setup it does not need, or the first contract waits for a
migration nobody prepared.

## Alternatives rejected

- **GCP from day one.** Cost and setup before there is anything to protect.
- **Self-hosted indefinitely.** A single VM answers a pilot's security questionnaire badly.
- **One VM per hotel.** Rejected in ADR-F9 on margin and on the single-data-store thesis.

## Consequences

- The OCI instance, Hetzner and GCP each need a sub-processor register entry before they hold anything.
  The OCI instance's region must be confirmed as EU.
- **The GCP identity must be BookOne's own:** its own project and account, never one borrowed from another
  client estate on this workstation.
