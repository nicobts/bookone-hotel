# ADR-F11 — Ops and security baseline
Status: Accepted · Date: 2026-09-27

## Decision (in priority order)
1 Zero-trust access for all internal surfaces via Tailscale · 2 Staff IdP with passkeys, separate from hotel users ·
3 Secrets in Secret Manager/Infisical, per-tenant credentials envelope-encrypted with KMS · 4 OpenTelemetry everywhere;
Phoenix for LLM spans, Grafana (Cloud EU or self-hosted) for infra/app; uptime checks; alerts to WhatsApp/Telegram ·
5 Webhook hardening (signature verification, rate limits, idempotency) · 6 Backups: Supabase PITR, quarterly restore
drill, written RPO/RTO · 7 dev/staging/prod, preview per PR, OpenTofu for GCP and the VM from Phase 0 ·
8 Dependency scanning, SBOM, signed images · 9 Config as data with history (flags, model tiers, rate limits, prompt
versions) · 10 GDPR mechanics: retention jobs, per-tenant export/erasure, DPIA before Phase 1 production, records of processing.
Explicitly out: Kubernetes, service mesh, Backstage, data lake.

## Consequences
+ Audit-ready operations at solo scale; acquirer due diligence has answers.
− Items 1, 3, 5, 7 are Phase 0 work (WP0.8); the rest land in Phases 1–2 and are tracked in the plan.
