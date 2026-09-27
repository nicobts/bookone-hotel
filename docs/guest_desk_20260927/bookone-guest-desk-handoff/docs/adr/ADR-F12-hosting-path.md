# ADR-F12 — Self-hosted for Phase 0/demo; GCP at the first signed contract
Status: Accepted · Date: 2026-09-27

## Decision
Deployment unit is constant: one container set (app, worker, admin, Phoenix) + Supabase EU as managed Postgres.
Phase 0/demo: existing OCI instance or a Hetzner EU VM, Docker Compose, Tailscale, Infisical, nightly snapshots.
Guest data lives in Supabase EU throughout; the VM holds compute and caches only.
Trigger for GCP: first signed pilot or paying contract, whichever first. Target: Cloud Run europe-west (app, worker,
admin), Secret Manager + KMS, Artifact Registry with signed images, Cloud Armor on webhook endpoints, Vertex AI
europe-west for models, all via OpenTofu. The GCP project, OpenTofu skeleton and CI deploy pipeline are created in
Phase 0 even if nothing runs there yet.
Rules: no pilot guest data on the self-hosted box without backups and a completed restore drill; migration is a
day if container + IaC exist, a month if they do not.
