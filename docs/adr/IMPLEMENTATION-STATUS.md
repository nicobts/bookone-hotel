# Implementation status

A decision recorded is not a decision shipped. This table is the gap.

Update it in the same PR that changes the answer — a status file that lags is
worse than none, because it is read as current.

| ADR | Decision | Built? | Where |
|---|---|---|---|
| 001 | Platform UUIDs; external systems via `external_refs` | ✅ as-built | Platform UUIDs everywhere; `external_refs` the only home for a foreign id; AuthorityMap + write-router in `src/authority` with both routes tested per domain (E6.2) |
| 002 | Fiscal core gated | ✅ as-built | Nothing fiscal exists, and the authority router refuses to grant the domain to the platform whatever a property row says — a row is data, so "we would never configure that" is not a control |
| 003 | Two deployables; worker is persistent | ✅ as-built | `apps/web`, `apps/worker`; constraint stated in the worker README |
| 004 | Hono on `@hono/node-server` | ✅ as-built | `apps/worker/src/app.ts` |
| 005 | pg-boss behind a `JobQueue` interface | ✅ as-built | `JobQueue` port in core, `PgBossQueue` the only file importing pg-boss. Verified live: enqueue to reflected in 780ms, against a 60s requirement |
| 006 | Supabase EU; Drizzle for domain access | 🟨 partial | Schema, access layer and Auth built on local Supabase. Cloud EU project not yet provisioned |
| 007 | RLS on every client-reachable table, tested in CI | ✅ as-built | 11/11 tables, both suites green, negative control verified, and a CI job of its own. The public booking surface has no JWT to police, so it runs under `asService` with explicit scoping — asserted by handing each function the other property's ids (`booking.test.ts`) |
| 008 | Mock-first connector | ✅ as-built | `MockEricsoftAdapter` with counted failure injection, plus the shared contract suite the real adapter must pass before the swap. Verified by negative control: removing the idempotency guard fails the contract |
| 009 | Voice hard tool boundaries | ⬜ WS-B | Not this workstream |
| 010 | Stripe behind `PaymentAdapter` | 🟨 port built, **provider not connected** | `PaymentAdapter` + `MockPaymentAdapter`, which moves no money. The interface, policy engine, `payments` ledger, `fee_events`, webhook-as-authority, signature check, redelivery idempotency and lost-webhook replay are all real and exercised. Blocked on 04 §0 item 6 (Stripe account, Connect Standard, commercialista). A real adapter must pass `describePaymentAdapterContract` — the suite the mock passes — before the swap, and the worker refuses to boot simulated in production |
| 011 | Agents as first-class workers, tiered autonomy | ✅ as-built | Registry, runner and typed tools; AG-05 live on reconciliation. The runner refuses an ungranted tool, scopes to one property, and records every run — including the ones that fail |
| 012 | `LlmProvider` abstraction; no vendor SDK imports | ✅ as-built | Interface and registry in `src/llm`; registration refuses any provider without declared EU processing, a region, a sub-processor register entry and a verification under a year old. No provider registered yet — that waits for a real requirement |
| 013 | Journey state machine is the single source of stay truth | ✅ as-built | Five dimensions, evented commands, `applyJourneyCommand` the only writer. Illegal transitions refused and separated from retries; every transition emits its event in the same transaction, so G1 is computable from the log alone. `journey_states` has no write policy at all — the console's arrival button will take the same command a door sensor will |
| 014 | Reference implementations over blank-page design | ✅ as-built | First note written before the first component: [booking-flow.md](../design-notes/booking-flow.md) — Mews + Booking.com studied, six deviations each tied to the wedge. Index and legal-hygiene rules in [design-notes/](../design-notes/README.md) |
| 015 | Pricing in €/room/month equivalence | ⬜ not yet | Sprint 8 reporting |
| 016 | Property is a URL segment | ✅ as-built | `/[locale]/[property]/console/…`; verified in a browser that a non-member typing another slug gets a 404, not a redirect |
| 017 | Identity tables sit outside tenancy | ✅ as-built | `profiles` isolated by `auth.uid()`; asserted separately in the suite |
| 018 | RLS enforced on the Drizzle path via `withUser` | ✅ as-built | `packages/core/src/db/session.ts`; removing the role-drop fails 8 of 21 |

## Sprint 3 additions

| Thing | Status | Note |
|---|---|---|
| `/book/[property]`, four steps, four locales | ✅ | Walked end to end in a browser in DE, IT and SL |
| Availability from `rate_snapshots`, stale fallback | ✅ | 15-minute threshold against a 2-minute refresh; oldest row decides |
| Booking hold | ✅ | A **price** hold, not an inventory hold — design note §4A |
| Confirmation notifications | ✅ | Transactional outbox; email only, `log` provider until an ESP clears D9 |
| Per-property theming | ✅ | `--bo-primary` / `--bo-accent` from `settings.theme`, validated as colours |

## Sprint 4 additions

| Thing | Status | Note |
|---|---|---|
| Deposit and cancellation policy engine | ✅ | Pure, provider-agnostic, DST-correct in the property's zone |
| `payments` ledger + `fee_events` | ✅ | Refunds negative so the column sums to what the property holds |
| Payment step inside step 4 | ✅ | With an unmissable simulated-payment notice, driven by the adapter's own flag |
| Webhook as the only state authority | ✅ | Signature checked; redelivery writes one fee, one confirmation, one email |
| Webhook-loss replay | ✅ | Every 2 minutes; recovers a paid-but-unconfirmed booking through the same code path |
| Self-service cancel (E1.4) | ✅ | Refund shown before confirm; recomputed server-side on submit |
| Fee computation (D14) | ✅ | Basis points, integer; conservative attribution rule with its evidence stored |
| **Real payment provider** | ⬜ **deliberately not built** | See ADR-010 row above and design-notes/booking-flow.md §4b |

## Sprint 5 additions

| Thing | Status | Note |
|---|---|---|
| Journey state machine (ADR-013) | ✅ | Five dimensions; 48 unit tests, mostly of refusals |
| `/stay/[token]` pre-arrival | ✅ | One page, three sections, each saving independently — resumable without a session |
| Signed stay tokens | ✅ | Stateless HMAC; the resolver re-reads the reservation, so cancellation revokes without a table |
| Documents to EU Storage | ✅ | Private bucket, no `authenticated` policy, paths carry ids only |
| T-48h invitation | ✅ | Hourly sweep, fanned out per stay; the machine makes re-running it safe |
| Console Today, live | ✅ | Arrivals ordered by stated time; **awaiting guest** is the only number that implies work |
| Alloggiati submission (E2.3) | ⬜ Sprint 6 | States and transitions exist; the channel does not |
| Document deletion job (E2.4) | ⬜ Sprint 6 | `documents.delete` and `deleteIdentityDocument` exist; the job that calls them on acknowledgement does not |

## Sprint 6 additions

| Thing | Status | Note |
|---|---|---|
| Payload builder + validation | 🟨 built, **layout unverified** | 168-character records; offsets and the country code tables need checking against the official spec before any real filing — [runbook](../runbooks/alloggiati.md) |
| `AlloggiatiAdapter` port + mock | ✅ | Contract suite; the mock validates record width rather than accepting anything |
| `alloggiati_submissions` audit trail | ✅ | Exact payload, checksum and receipt retained |
| Auto-file on arrival, manual file always | ✅ | E2.3 requires the override; the property is the declarant |
| T-20h overdue alert | ✅ | In the exceptions inbox, linking to the arrival screen |
| Document deletion on acknowledgement (E2.4) | ✅ | Object first, row second; a failed delete leaves the row honest |
| Contract mirror | 🟨 **drafted, not reviewed** | [alloggiati-responsibility.md](../contracts/alloggiati-responsibility.md) — five open questions for counsel |
| **A real channel** | ⬜ **blocked** | Direct web service vs certified intermediary (04 §0 item 5) |

## CI gates

All five exist as separate jobs in `.github/workflows/ci.yml`, named so a
failure identifies itself: `static`, `test`, `rls`, `migrations`, `evals`. The
evals job is green because the roster is empty — the gate is in place before the
agents are, so none can ship without one.

## The ADR-007 note — now closed

ADR-007 says the database enforces isolation. That was true of the path a client
takes (PostgREST with a user JWT) and **not automatically true of the path the
application takes** (Drizzle over `DATABASE_URL`).

Measured on this project's own database rather than assumed: the role in
`DATABASE_URL` has `rolbypassrls = t`, so every policy was invisible to it and a
plain `select` returned every property's rows — no error, no failing test.

"RLS is on" is therefore two claims, each with its own suite:

- policies hold for a JWT-bearing client — `client.test.ts`
- the application asks the database to apply them, per request, per user —
  `session.test.ts`, via `withUser` (ADR-018)

Both are green, and the second was checked by negative control: removing the
role-drop fails 8 of 21. A suite that has never been seen to fail is not
evidence.
