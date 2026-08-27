# 03 — Architecture: BookOne Platform V1

Stack-specific implementation of the canonical/dual-source architecture (Piattaforma annex) on the SNB-reference stack.

---

## 1. System topology

```
┌─ Vercel (fra1) ────────────────────────────────┐
│  Next.js App Router (one app, three surfaces)  │
│   /book/[property]   guest booking (public)    │
│   /stay/[token]      guest journey (tokened)   │
│   /console           owner/staff (authed)      │
│   /api/*             route handlers (light)    │
└───────────────┬────────────────────────────────┘
                │ Drizzle (pooled, RLS-aware)
┌───────────────┴────────────────────────────────┐
│  Supabase (EU/Frankfurt)                       │
│  Postgres · Auth · Storage (docs) · Realtime   │
└───────────────┬────────────────────────────────┘
                │
┌───────────────┴────────────────────────────────┐
│  Worker service — Hono + Node, Fly/Hetzner EU  │
│  LONG-RUNNING, NOT EDGE, NOT SERVERLESS        │
│  pg-boss jobs · sync engine · reconciliation   │
│  connectors (Ericsoft, Stripe webhooks relay,  │
│  WhatsApp, Alloggiati) · tool endpoints for    │
│  voice concierge · notification fanout         │
└────────────────────────────────────────────────┘
External: Stripe · WhatsApp BSP · Ericsoft · Voice runtime (WS-B)
```

**Two deployables, one database** (same principle as the Concierge annex). The worker README carries the standing constraint: *persistent Node process; not deployable to edge runtimes* — required by pg-boss polling, connector polling, MQTT later (Rooms), and warm PMS connections.

### Deliberate simplifications vs earlier annexes

| Earlier | V1 choice | Why |
|---|---|---|
| Fastify | **Hono (@hono/node-server)** | Team familiarity (per Nicolas); RPC-mode types shared with Next.js; equivalent capability |
| Redis + BullMQ | **pg-boss on Postgres** | One less stateful service; EU residency trivially inherited; adequate at ≤10k jobs/day. Revisit at scale — interface `JobQueue` abstracts it |
| Self-managed Postgres | **Supabase EU** | Auth+RLS+Storage bundled; migration path out is plain Postgres |

## 2. Data model (Drizzle sketch — canonical core)

```ts
// tenancy
properties(id uuid pk, slug, name, locale_default, languages jsonb,
  timezone, settings jsonb, authority_map jsonb, created_at)

// identity & refs (D10)
external_refs(id pk, property_id fk, system text, entity_type text,
  entity_id uuid, external_id text, last_synced_at,
  unique(system, entity_type, external_id))

// domain
guests(id pk, property_id, name, email, phone, locale, marketing_consent)
room_types(id pk, property_id, code, name_i18n jsonb, capacity)
rate_snapshots(id pk, property_id, room_type_id, date_from, date_to,
  price_cents, source, fetched_at)            -- display cache, never authority
reservations(id pk, property_id, guest_id, room_type_id, status,
  arrival_date, departure_date, pax jsonb, total_cents, currency,
  origin text /*platform|sync*/, engine_session_id, concierge_session_id,
  created_at)
journey_states(reservation_id pk, precheckin_state, documents_state,
  alloggiati_state, arrival_state, departure_state, updated_at)
registration_records(id pk, reservation_id, guest_index, data jsonb,
  document_ref text /*storage path*/, validated_at, deleted_at)
alloggiati_submissions(id pk, reservation_id, payload_checksum,
  submitted_at, receipt jsonb, status)
payments(id pk, reservation_id, stripe_ref, kind /*deposit|balance|extra|refund*/,
  amount_cents, status, occurred_at)
message_threads(id pk, reservation_id, channel, external_thread_ref)
messages(id pk, thread_id, role /*guest|ai|staff*/, body, tool_calls jsonb, at)
tasks(id pk, property_id, reservation_id?, kind, status, assignee_role, due_at)

// dual-source machinery
domain_events(id bigserial pk, property_id, entity_type, entity_id,
  event_type, payload jsonb, origin /*platform|sync|reconciliation*/,
  actor, at)                                   -- append-only
reconciliation_runs(id pk, property_id, domain, ran_at, parity_ratio,
  discrepancies_count)
discrepancies(id pk, run_id fk, entity_ref, class /*rounding|tz|logic*/,
  ours jsonb, theirs jsonb, status /*open|explained|blocking*/)

// billing (D14)
subscriptions(property_id pk, plan, base_fee_cents, started_at)
fee_events(id pk, property_id, reservation_id, kind /*direct_pct|ai_pct|module*/,
  basis_cents, fee_cents, evidence jsonb, period)
attribution_events(id pk, reservation_id, session_kind /*voice|chat*/,
  session_ref, decided_rule, evidence jsonb, disputed bool default false)

// agent layer (ADR-011; full spec in 06-AI-AGENT-LAYER §3)
agent_runs(id pk, agent, property_id, trigger_event_id, input_ref,
  tool_calls jsonb, output jsonb, confidence, tier_applied,
  outcome /*accepted|edited|rejected|auto*/, reviewed_by,
  cost_cents, latency_ms, model, at)
```

Rules enforced in review/CI: external ids never used as keys (E6.1); every mutation emits a `domain_events` row; `rate_snapshots` is display-only and carries provenance.

## 3. Multi-tenancy & security

- **RLS on every client-reachable table**, keyed by `property_id` via JWT claims (owner/staff) — guest surfaces use short-lived signed tokens resolved server-side, guests never hold Supabase sessions.
- Worker uses service-role through a thin data layer that *still* scopes by property explicitly — service-role ≠ permission to write unscoped queries; CI test suite attempts cross-tenant access with each role (E7.2).
- Documents: private Storage bucket, EU; signed URLs ≤10 min; encryption at rest; hard-delete job post-Alloggiati acknowledgment (E2.4).
- Secrets: platform env vaults; per-property PMS credentials encrypted (pgsodium) — never in `settings`.
- Stripe: Connect Standard per property (money flows hotel-ward; our fees via application fees or invoiced separately — decide with commercialista; schema supports both via `fee_events`).

## 4. Dual-source engine (implementation of Piattaforma annex)

```ts
interface PmsAdapter {            // shared with Concierge/Rooms workstreams
  getAvailability(q): Promise<AvailabilityResult>
  getReservation(q): Promise<Reservation|null>
  reflectReservation(r: Reservation): Promise<ExternalRef>   // write-through
  postCheckIn(reservationId, at): Promise<void>
  healthCheck(): Promise<AdapterHealth>
}
```

- **MockEricsoftAdapter** ships first (WS-C blocked): deterministic fixtures + configurable latency/failure injection, so exception paths are built and tested before the real API exists.
- Sync jobs (pg-boss): `availability.refresh` (2–5 min/property), `reservation.reflect` (on event, idempotency key = reservation UUID), `reconcile.nightly` (per domain).
- Reconciliation output is a product surface (console exceptions + trend), not a log file.
- AuthorityMap lives on `properties.authority_map`; the write-router reads it per domain; both routes unit-tested per domain (E6.2).

## 5. Guest journey as a state machine

Single source of truth `journey_states`, transitions only via evented commands:

```
booking.confirmed → precheckin.invited → precheckin.submitted
 → documents.validated → alloggiati.staged → arrival.confirmed
 → alloggiati.submitted → stay.active → departure.settled → stay.closed
```

Every transition: writes `domain_events`, may enqueue jobs (notify, reflect, submit), and updates console Today/exceptions via Supabase Realtime. Arrival triggers accepted only from reservation-scoped sources (E3.1). Rooms/IoT later plugs in as just another trigger source — no journey changes.

## 6. i18n

next-intl, locales `it de en sl`; guest locale from booking choice persisted on reservation; all templated notifications localized; property content fields are `*_i18n jsonb` with fallback chain (guest → property default → en).

## 7. Payments flow (Stripe)

1. Booking hold (30 min) → PaymentIntent (deposit/full per policy) + SetupIntent for vaulting when policy requires
2. Webhooks (worker) are the only state authority: `payment_intent.succeeded` → confirm reservation → journey start
3. Extras during stay → PaymentIntent off-session with vaulted card or express-checkout link
4. Refunds computed from policy engine; every movement → `payments` + `fee_events` where applicable
5. Italian provider swap later = new `PaymentAdapter` implementing the same interface; policy engine and folio-lite untouched.

## 8. Observability & ops

- Sentry (EU) both deployables; structured pino logs; pg-boss dashboard; per-adapter `AdapterHealth` gauge surfaced in console (owners see connector status honestly).
- Alert classes: blocking discrepancy, Alloggiati unconfirmed T-20h, reflection queue depth, webhook failure streak, RLS test failure (CI-blocking).
- Backups: Supabase PITR + nightly logical dump to EU object storage (Scaleway) — restore drill before Beta.

## 9. Environments

| Env | Purpose | Notes |
|---|---|---|
| `local` | dev | Supabase CLI local; MockEricsoft; Stripe test |
| `staging` | integration | EU Supabase project; seeded demo property; Stripe test; WhatsApp sandbox |
| `prod` | live | EU; migrations via CI only; feature flags per property |

Migrations: Drizzle Kit, forward-only, reviewed; RLS policies live in versioned SQL alongside schema; seed scripts per environment.

## 10. What Claude Code should know (repo conventions)

- Monorepo (pnpm + turbo): `apps/web` (Next.js), `apps/worker` (Hono), `packages/core` (canonical domain: schema, state machine, policy engine, adapters' interfaces), `packages/adapters` (mock + real connectors), `packages/i18n`.
- **All domain logic in `packages/core`** — both deployables import it; neither reimplements it.
- Type flow: Drizzle schema → core types → Hono RPC → web. No hand-written duplicate types.
- Tests: vitest; every P0 AC maps to at least one test; RLS suite (E7.2) and tool-boundary audit (E3.2) run in CI as gates.
