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
| 009 | Voice hard tool boundaries | 🟨 discipline applied to chat | Voice is WS-B. The *boundary* is built and measured here: every AG-01 tool returns a pre-formed `phrase`, the reply is that phrase verbatim, and a nightly job re-reads what was sent against the tool outputs of its own run. Zero violations is the gate |
| 010 | Stripe behind `PaymentAdapter` | 🟨 port built, **provider not connected** | `PaymentAdapter` + `MockPaymentAdapter`, which moves no money. The interface, policy engine, `payments` ledger, `fee_events`, webhook-as-authority, signature check, redelivery idempotency and lost-webhook replay are all real and exercised. Blocked on 04 §0 item 6 (Stripe account, Connect Standard, commercialista). A real adapter must pass `describePaymentAdapterContract` — the suite the mock passes — before the swap, and the worker refuses to boot simulated in production |
| 011 | Agents as first-class workers, tiered autonomy | ✅ as-built | Registry, runner and typed tools; AG-01, AG-05 and AG-07 live. The runner refuses an ungranted tool, scopes to one property, and records every run — including the ones that fail. AG-07 is the first agent that moves money, and it can only move it **down**: there is no tool that raises a fee, which is the asymmetry that makes a T1 agent near billing defensible |
| 012 | `LlmProvider` abstraction; no vendor SDK imports | 🟨 port built, **no provider registered** | Interface and registry in `src/llm`; registration refuses any provider without declared EU processing, a region, a verification under a year old, and a sub-processor register entry **that exists** — Sprint 10 made that last one a lookup against `privacy/subprocessors.ts` rather than a non-empty-string check, which any typo satisfied. `LLM_API_KEY` is empty and AG-01 runs as a deterministic router — which is not a stopgap for the tool boundary but the shape it has to keep: a model would widen recall, never authorship (binding rule 7) |
| 013 | Journey state machine is the single source of stay truth | ✅ as-built | Five dimensions, evented commands, `applyJourneyCommand` the only writer. Illegal transitions refused and separated from retries; every transition emits its event in the same transaction, so G1 is computable from the log alone. `journey_states` has no write policy at all — the console's arrival button will take the same command a door sensor will |
| 014 | Reference implementations over blank-page design | 🟨 as-built, **one note written late** | Seven notes in [design-notes/](../design-notes/README.md), all but one written before their surface; [pre-arrival.md](../design-notes/pre-arrival.md) records a Sprint 5 surface that shipped without one and says so at the top rather than being backdated. Three surfaces had no reference row in 08 §3 — in-stay messaging, the monthly report and the privacy desk — and each note proposes its own and argues the deviations. The table now carries all three |
| 015 | Pricing in €/room/month equivalence | ✅ as-built | On the monthly report, **including the percentage fees** — the number shown is the number billed. Null rather than a guess when the subscription records no room count: `room_types` holds types, not rooms, and a derived figure would be wrong and look authoritative on the one line built for comparison against a competitor's price |
| 016 | Property is a URL segment | ✅ as-built | `/[locale]/[property]/console/…`; verified in a browser that a non-member typing another slug gets a 404, not a redirect. Sprint 9 adds the same treatment for role: a staff member typing an owner-only URL gets 404, so "you are not a member" and "you may not see this" are indistinguishable from outside |
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

## Sprint 7 additions

| Thing | Status | Note |
|---|---|---|
| Arrival from three triggers (E3.1) | 🟨 two live, one interface-only | Guest tap and staff tap both take `arrival.confirm`; the door event is a port with a checklist and no vendor (`stay/door.ts`). The actor distinguishes them, because G1 counts the arrivals that needed nobody at a desk |
| PMS check-in post | ✅ | Through the adapter, and its failure cannot swallow the welcome — a guest without a door code is a different problem from a PMS that is down |
| Welcome message | ✅ | Facts from rows only. A property that has not recorded a wifi password gets a message with no wifi line, never a guessed one |
| Thread per stay (E3.2) | ✅ | One conversation, four author kinds, status = who owes the next reply |
| AG-01 concierge | 🟨 live, **no model connected** | Deterministic router over the property's own KB. Answers or escalates; there is no branch that composes a sentence |
| Knowledge base | 🟨 schema + seed, **no authoring UI** | E5.3 is Sprint 9. Until then rows are seeded, so the concierge escalates more than it answers — the correct failure direction |
| Tool-boundary audit | ✅ | Nightly, per property. Two checks: the reply must appear in its own run's tool output, and every number in it must too. Gate is zero |
| Escalation + one-tap takeover (E3.3) | ✅ | Stay card above the composer; unowned work sorts first and is the only loud badge on the screen |
| Unanswered-escalation SLA alert | ✅ | 30 minutes, to the property, exactly once — `sla_alerted_at` rather than a recomputation |
| Requests become tasks (E3.4) | ✅ | P1, built because `create_task` is in AG-01's grant and the alternative is an agent promising into a void. The phrase says *recorded*, never *done* |
| Express checkout (E4.1) | ✅ | States what it does not know: the folio lives in the PMS, and the screen says so rather than showing a confidently short total |
| Invoice request | ✅ | **Issues nothing.** Recorded and routed to the property, who issue the fattura through their own certified chain (D11) |
| Review request | ✅ | After departure is confirmed, once, unconditional on what the guest said — not on the checkout screen beside a payment step |
| Departure sweep | ✅ | Nightly backstop under `system`, so a guest-confirmed checkout and an inferred one stay distinguishable |
| **A language model** | ⬜ **not connected** | `LLM_API_KEY` empty; no provider passes D9 registration yet. The eval set is what makes connecting one a measurement rather than a leap |
| **WhatsApp** | ⬜ **blocked** | BSP verification (04 §0). The thread is stored channel-agnostically; adding it is a provider, not a re-model |

## Sprint 8 additions

| Thing | Status | Note |
|---|---|---|
| `attribution_events` + D14's real rule | ✅ | Replaces Sprint 4's proxy. The proxy under-attributed, so the switch can only move fees **up** — a conversation with an owner rather than a refund to one |
| Monthly report (C4) | ✅ | Three sections with the arithmetic shown, zero lines included rather than dropped |
| Frozen when issued | ✅ | Verified live: five more bookings landed after issuing and the statement did not move |
| Evidence drill-down | ✅ | Per attributed line: which conversation, when it started, engine visits in the window **including the ones that did not disqualify it** |
| Dispute per line (D14) | ✅ | Credited on the spot, no adjudication step. There is no `rejected` status to reach |
| CSV export | ✅ | Semicolon-delimited and BOM-prefixed, because the market opens it in Excel; first line says it is not a fiscal document |
| "PDF" | 🟨 **print the page** | Deliberately not a second renderer. Two renderers of one statement can disagree, and the one nobody looks at is the one that gets sent |
| Subscriptions (D14 row 1) | ✅ | History by ending a row, never editing it — March's report must still say what March cost after June's price change |
| AG-07 Attribution Auditor | ✅ | Nightly. Verified live: planted a late touch, it credited €72.00 automatically and credited nothing on the rerun |
| **AG-04 Exception Triage** | ⬜ **not built** | 06 §5 puts it in this sprint. Deferred rather than half-built — see below |
| **AG-05 full (T2 status changes)** | ⬜ **not built** | Needs the T2 proposal surface, which nothing yet has |
| **Module / per-room fees (D14 row 4)** | ⬜ not yet | Entitlement flags are Sprint 9; the report line is designed for and unpopulated |

### What was deliberately left

06 §5 lists AG-04 and full AG-05 for this sprint. Both are **T2** — they
propose and a human taps — and the diff-card surface that a T2 proposal is
reviewed on does not exist. Building the agents first would produce two agents
whose output has nowhere to go, and a tier that is enforced by there being no
button rather than by design. The proposal surface is the honest prerequisite
and it is Sprint 9 work.

## Sprint 9 additions

| Thing | Status | Note |
|---|---|---|
| Property setup checklist (E7.1) | ✅ | Derived from the rows the product reads — no `setup_completed` column to drift and tell an owner to redo something |
| Nothing gated on completion | ✅ | Blocking items are the ones a booking fails on anyway; the surface names them and lets the rest wait |
| Knowledge editor (E5.3) | ✅ | Per topic, all languages on one screen, version bumped in SQL, live on the next question — no cache to invalidate |
| Missing languages named | ✅ | Shown as a badge per article. Each one is a language the concierge escalates in, and there is no translate button |
| Staff role (E5.5) | ✅ | `requireOwner` on every owner-only page *and* action. Verified live: staff sees five nav items, and `/console/knowledge` 404s |
| Entitlements (E7.3) | ✅ | Absence is the default and the default is off, so a plumbing bug fails closed. Revoking ends a row; "never had it" and "had it until March" stay distinguishable |
| AG-03 onboarding | 🟨 built, **heuristic not a model** | Fetches the property's site and drafts articles from headings. Verified live: 2 drafts written, an unclassifiable section skipped, existing answers untouched. T2, and structurally so — everything lands unpublished and `searchKb` refuses to quote it |
| Egress guard on user-supplied URLs | ✅ | Resolves and refuses any private, loopback, link-local or reserved address, re-checking every redirect hop. Verified against the live Supabase endpoint on this machine, which *was* reachable before it |
| Onboarding runbook | ✅ | [onboarding.md](../runbooks/onboarding.md), written for the ≤5-day DoD |
| **Stripe Connect onboarding** | ⬜ **blocked** | E7.1 names it; 04 §0 item 6 |
| **Demo-mode toggle** | ⬜ **deliberately not built** | E7.1 names it. The seed script serves the people who currently need it, and a toggle that generates fake bookings inside a real property's console is a support incident waiting to be filed |
| **Generic T2 proposal surface** | ⬜ not yet | AG-03's proposals are KB drafts, reviewed in the editor. AG-04 and full AG-05 need diff-cards for proposals that are *not* rows an owner already edits |

### The SSRF an automated review found

AG-03's `fetchPage` shipped with a scheme check and nothing else. It runs inside
the worker, against a URL an owner types, and **stores the response where they
can read it** — so it was a read primitive against everything the worker can
reach, rendered in the requester's own console. Not blind SSRF; an exfiltration
path.

Verified before the fix: `http://localhost:54421/rest/v1/` — the Supabase
endpoint on the same host — returned a body. After: refused, along with
169.254.169.254, `[::1]`, `metadata.google.internal` and `file://`, while
`https://example.com/` still fetches.

The guard resolves the hostname and refuses if **any** resolved address is
private; checking only the first is a bypass that depends on resolver ordering,
which is to say one that works eventually. A negative control weakening it to
first-address-only fails exactly the test that asserts it.

Residual: DNS rebinding, because this is check-then-connect and Node's `fetch`
will not pin to a validated address. The real answer is an egress proxy
enforcing the allowlist at the network layer — Sprint 10, with the pen test.

### The bug this sprint's suite found

`revokeEntitlement` wrote an app-generated `ended_at` into a column whose
`granted_at` is written by the database, with a check constraint comparing them.
This machine's clock is ~600ms behind the database container's, so the revoke
failed the constraint — intermittently, depending on how much wall-clock time
passed between grant and revoke. It passed in isolation and failed in a full run.

Both `ended_at` writes now use `now()`. The rule: **two timestamps compared by a
constraint must come from one clock**, and the database already has one. This is
the same class as the bug AG-07 caught in Sprint 8, which is the second time it
has cost something — worth remembering as a class rather than as two incidents.

## CI gates

All five exist as separate jobs in `.github/workflows/ci.yml`, named so a
failure identifies itself: `static`, `test`, `rls`, `migrations`, `evals`.

The evals gate is no longer green by vacancy. AG-01's golden set asserts in
pairs — for each capability, one case that must be answered and one adjacent
case that must **not** be — because a set that only asserts the happy direction
is satisfied by an agent that says yes to everything.

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

## Sprint 10 additions

| Thing | Status | Note |
|---|---|---|
| The data map | ✅ | `packages/core/src/privacy/data-map.ts`: every table, whose data, the basis, the period, what erasure does. TypeScript rather than a document because a document does not fail CI — a table missing from it fails a test on the same run as the migration that added it |
| Export bundle (E8.1) | ✅ | JSON with a manifest covering **every** table in the map, including the empty ones and the three excluded with a reason. Generated on demand, never stored, no cache headers, owner-only |
| Erasure (E8.1) | ✅ | Anonymise the guest, delete what a guest wrote, redact what quotes them, keep what Art. 17(3)(b) requires with the reason shown before the button. Two steps and a background job |
| Retention sweep (E8.2) | ✅ | One scheduled job per property at 02:15, driven by the map. Idempotent by predicate, per-rule reporting, one failing rule does not stop the rest |
| Request desk (E8.1) | ✅ | `privacy_requests`, owner-only by policy, with an Art. 12(3) deadline computed by the database in the same statement as `created_at`. No free-text field, deliberately |
| Sub-processor register (E8.3) | ✅ | Generated from `privacy/subprocessors.ts` into `docs/legal/`, with `pnpm register:check` as a CI gate. `registerProvider` now asks the register whether an entry id exists |
| Backup-restore drill | 🟨 **done, and it failed three times first** | [backup-restore.md](../runbooks/backup-restore.md). Logical dump → restore passed on the third attempt. PITR itself is untested and is a GA blocker |
| Load test | 🟨 **done locally, not on staging** | [load-test.md](../runbooks/load-test.md). 1,520 bookings, zero failures, throughput plateaus ~80/s with latency rising linearly — a saturated pool with a fair queue, not a fault |
| **Egress proxy** | ⬜ not built | The residual DNS-rebinding risk from Sprint 9's SSRF fix. Network-layer work, and it belongs with the pen test |
| **External pen test** | ⬜ not started | Nothing in this sprint substitutes for it |
| **PITR restore drill** | ⬜ not run | Named in the runbook as the next drill and a GA blocker |
| **Deadline alerting** | ⬜ not built | The desk shows a due date; nothing emails the owner at day 25. Needs notification templates |

### What the erasure suite found

The test plants a distinctive name, email and phone in every table that can hold
one, erases, then searches **every text and jsonb column in the schema** for
them. Not the four tables the author remembered — that version passes in exactly
the situation the feature exists to prevent.

On the first clean run it found two survivors.

`invoice_requests.bill_to` was one, and the data map was wrong rather than the
test. The map had claimed a carve-out on the grounds that the property issues
the actual invoice and keeps their own copy — true, and beside the point: ours
is a routing record, not the fiscal document, and it was sitting there with the
guest's name in a column called `bill_to`. Now redacted.

`alloggiati_submissions.payload` was the other, and it stays. The transmitted
text names every guest in the party, so honouring one person's request by
deleting it would destroy another person's record and the property's evidence of
a legal filing together (Art. 17(3)(b)). It goes on a two-year clock from
acknowledgement instead, keeping the checksum and the receipt forever — and the
desk tells the requester that date rather than implying the filing is gone.

The assertion is therefore an exact list rather than an empty one. An empty
assertion would have to be weakened the moment a lawful carve-out exists, and a
weakened assertion is how the next unlawful residue gets through.

### The rule that could not have run

The data map declared `payments`, `fee_events` and `alloggiati_submissions` as
cascading off a reservation. They are `restrict` — deliberately, because money
and a filing with a public authority should not vanish because somebody deleted
a stay — and `external_refs` points at a reservation by id with no foreign key
at all.

So the ten-year reservation rule would have thrown on its first non-empty run,
at 02:15, in a job nobody watches, having deleted nothing.

Caught by a test that reads the schema's own foreign keys and compares them
against what the map claims, rather than checking the map against itself. The
rule now declares its dependents and the sweep clears them in order; removing
one from that list fails the test by name.

### The drill that failed three times

Recorded in full in the runbook, because a drill log with only successes in it
is a log somebody has been editing.

1. The dump carries `pgboss.*` and the restore has nowhere to put it — pg-boss
   creates its schema at worker boot, not in a migration. The fix is not to
   create the schema first; it is to never back the queue up. Restoring 65 rows
   of job history would replay work that already ran, and duplicate Alloggiati
   filings are not harmless.
2. The dump carries `storage.buckets`, which a migration also creates. The
   general form is larger than one bucket: a data-only dump restored over a
   migrated schema collides with every row the migrations themselves insert.
3. `supabase db dump` does not produce a standalone restorable schema — it omits
   the Supabase-managed schemas it assumes are present. This is the one that
   would otherwise have been discovered during an incident: **you cannot rebuild
   a Supabase project from a logical dump.** PITR is the recovery mechanism; the
   dump is the exit path and restores *into* a working project.
