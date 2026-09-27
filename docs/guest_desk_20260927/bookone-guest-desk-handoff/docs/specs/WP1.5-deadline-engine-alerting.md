# WP1.5 — Deadline engine and staff alerting
Depends on: WP1.1 · Est.: 1 week

## Build
- Per-obligation countdown; alert ladder (inbox → staff WhatsApp → owner WhatsApp) configurable per tenant.
- Owner agent tools: `list_obligations_due`, `list_obligations_failed`.
- Escalation before expiry, never after.

## Acceptance criteria
- [ ] Fake-clock tests: alerts fire at configured offsets; nothing fires twice.
- [ ] Zero missed 24h Alloggiati deadlines across a 30-day simulation with injected failures.
