# WP0.5 — Demo tenant, seeded data, knowledge base, owner back-office agent
Depends on: WP0.1 · Est.: 3 days · Parallel with WP0.2–0.4

## Build
- `scripts/seed-demo.ts`: idempotent, from a clean DB: tenant, rooms, rate table, policies, 25 bookings across past/present/future (some with capture sessions in each state, two open complaints), staff and owner users with verified WhatsApp numbers.
- Knowledge base: `content/demo/hotel/*.md` (amenities, hours, parking, pets, policies) and `content/demo/local-guide/*.md` (transport, events, restaurants, museums — curated, dated). Ingest script → `knowledge_chunks` with source tag and embeddings.
- IT and EN versions of all content.
- Owner back-office orchestrator wiring: WhatsApp number → owner identity → `owner-backoffice` profile; guests can never reach it.

## Acceptance criteria
- [ ] `seed-demo` runs twice without duplicates.
- [ ] `search_knowledge` returns the right chunk for 20 fixed IT/EN questions (golden test).
- [ ] Owner asks "quanti arrivi domani?" and gets the seeded answer; a guest number sending the same gets routed to a guest profile.
## Stop and ask
Use of any real hotel's content without written permission.
