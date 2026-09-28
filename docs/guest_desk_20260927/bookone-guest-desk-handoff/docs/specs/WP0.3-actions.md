# WP0.3 — Real actions behind the MCP tools
Depends on: WP0.2 · Est.: 5–7 days

## Goal
Every Phase 0 profile completes its primary action end-to-end against the demo tenant's data.

## Tools to implement (replace WP0.2 stubs)
| Tool | Profile | Behaviour | Reversible |
| --- | --- | --- | --- |
| check_availability, quote_stay, create_booking_link | pre-sale | Read BookOne booking store (seeded); quote from rate table; link to existing booking engine or Stripe checkout | n/a |
| find_booking, modify_booking, cancel_booking | booking-support | Policy check in code (`policy.ts`), then write; cancel requires approval | modify: yes; cancel: no |
| create_payment_link, get_payment_status, explain_charges | payments | Stripe test mode; link tied to booking; webhook updates status | link: void-able |
| send_prearrival_link, record_eta, get_capture_status | pre-arrival | Creates capture session (WP0.4 owns the capture itself) | yes |
| request_late_checkout, request_invoice | checkout | Policy check; creates staff task | yes |
| log_complaint, notify_owner | complaints | Complaint row with category + SLA deadline; owner WhatsApp template message | no |
| list_arrivals, list_capture_status, list_open_complaints, list_pending_approvals | owner-backoffice | Read-only queries scoped to tenant | n/a |
| search_knowledge | general-info, checkout | Hybrid search (tsvector + pgvector) over `knowledge_chunks` tagged by source | n/a |

## Rules
- Idempotency key on every write tool (thread_id + tool + hash(input)).
- Policy checks are code in `src/domain/policy.ts`, never model judgement.
- Owner WhatsApp notifications use approved templates (outside the 24h window); template names in config.

## Touches
`src/mcp/tools/**`, `src/domain/policy.ts`, Stripe test integration, `knowledge_chunks` schema, complaint schema.
## Must not touch
Router hard rules, profile JSON (except adding a tool name if the spec here requires it — say so in the PR).

## Acceptance criteria
- [ ] Each primary action runs end-to-end from a WhatsApp sandbox message and from webchat (demo script per profile).
- [ ] No write executes twice for the same idempotency key (test).
- [ ] `cancel_booking` and `create_payment_link` never execute without the approval step (test).
- [ ] Complaint SLA deadline computed and owner notified within 60 s in the demo.
- [ ] Owner agent answers "chi non ha ancora mandato i documenti?" from seeded data.
## Tests
Unit per tool; contract tests against the MCP server; evals `evals/wp0.3/` (≥ 5 per profile including one refusal each).
## Stop and ask
Anything touching Stripe live mode. Any new table. Any tool not in this list.
