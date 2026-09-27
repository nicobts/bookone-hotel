# WP1.2 — AlloggiatiWeb adapter (national)
Depends on: WP1.1 · Est.: 2 weeks · Blocked on: software-house registration + one pilot hotel's credentials + certificate

## Build
- Web-service client with certificate handling, per-tenant credentials in Secret Manager, test/production endpoints.
- Schedina → service payload mapping with the official field validation (codes for comuni, stati, documenti — load the official tables, keep them updatable).
- Error mapping to obligation states; retry policy respecting the 24h rule; escalation at T−2h.
- Receipt stored as evidence; daily reconciliation job comparing submitted vs. acknowledged.

## Acceptance criteria
- [ ] Test-environment submission of the three fixture guests (CIE, EU passport, non-EU passport) acknowledged.
- [ ] Invalid comune/stato code caught before submission with a staff-fixable message.
- [ ] Outage simulation: retries, then manual fallback, then evidence once resubmitted.
## Stop and ask
Any production submission; any credential handling outside Secret Manager.
