# ADR-032 — The ops and security baseline is a fixed list delivered in priority order

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-006, ADR-029, ADR-030, ADR-031 · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F11, mapped to what the repo already has

## Triggering event

The plan puts a demo in front of an association and, soon after, pilots with real guests. The GA list in
CLAUDE.md already names the pen test, the egress proxy and the PITR drill. What is missing is a single
ordered list of the operational controls, so that "is this production-ready" has a checklist rather than
an impression.

## Decision

The baseline, in priority order. The Phase 0 items are delivered in WP0.8.

| # | Control | Phase | Already in the repo |
|---|---|---|---|
| 1 | Zero-trust access (Tailscale) for every internal surface | 0 | — |
| 2 | Staff IdP with passkeys, separate from hotel users (ADR-031) | 0 | — |
| 3 | Secrets from a secrets manager (Infisical on the VM, Secret Manager on GCP); per-property credentials envelope-encrypted with KMS | 0 | — |
| 4 | OpenTelemetry in every service; LLM spans to Phoenix, everything else to Grafana (EU); uptime checks; alerts to WhatsApp/Telegram | 0–1 | pino logs only |
| 5 | Webhooks: signature verification, idempotency on the provider event id, rate limits | 0 | Stripe signature and redelivery idempotency ✅; rate limits and the Meta webhook are new |
| 6 | Backups: PITR, quarterly restore drill, written RPO/RTO | 0 | Logical drill done, PITR drill not run (`docs/runbooks/backup-restore.md`, GA blocker) |
| 7 | dev / staging / prod, a preview per PR, OpenTofu for the VM and GCP | 0 | Environments named; no IaC |
| 8 | Dependency scanning, SBOM, signed images | 1 | — |
| 9 | Config as data with history (flags, model tiers, rate limits, prompt versions) | 1 | Flags ✅ (entitlements keep history, ADR-019) |
| 10 | GDPR mechanics: retention, per-property export and erasure, DPIA before Phase 1 production, records of processing | 1 | Retention, export, erasure and the register ✅ (Sprint 10); DPIA not done |

**Rules that bind from now on:**
- No internal surface gets a public ingress.
- Secrets are never committed. `.env` stays local, and `.env.example` holds names only.
- Every new service gets a sub-processor register entry before first use. That includes Tailscale (its
  coordination plane is US-based), Infisical, Grafana and Phoenix (ADR-029).
- **Infrastructure-as-code commands (`tofu`, `terraform`) run from WSL, never from the Windows shell.**
  Modules that derive keys from file paths break on backslashes, and you cannot tell from outside which
  modules do.

**Explicitly out:** Kubernetes, service mesh, Backstage, a data lake.

## Cost of change / cost of not changing

**If wrong:** each item is independent. Dropping one costs only that control.

**If not done:** controls get added in the order incidents reveal them, which is the most expensive order.

## Alternatives rejected

- **Defer all of it to GA.** Items 1, 3 and 5 protect the demo itself: the admin console, provider keys and
  webhooks are live from Phase 0.

## Consequences

- WP0.8's restore drill extends `docs/runbooks/backup-restore.md`; there is no new `docs/ops/` file.
- The CLAUDE.md "before GA" list and this table must agree. When one changes, the other changes in the
  same PR.
