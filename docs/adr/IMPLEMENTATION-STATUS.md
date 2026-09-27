# Implementation status

A decision recorded is not a decision shipped. This table is the gap.

Update it in the same PR that changes the answer — a status file that lags is
worse than none, because it is read as current.

## Guest Desk Phase 0 — acceptance (plan §4), as of 2026-09-27

**Not complete.** The code is in place for every item. What is left is
verification with real accounts and three human tasks.

| Acceptance item | State | What is left |
|---|---|---|
| Profiles 1–7 + owner agent end to end on webchat, IT and EN | ✅ | — |
| …and on WhatsApp | 🟨 built (ADR-035) | Run it against the Twilio sandbox; Meta Business verification for a real number |
| Every action in the audit log (actor, tool, input, result, reversibility) | ✅ | — |
| No money action without human approval, shown live | ✅ | — |
| Schedina preview from CIE, EU passport, non-EU passport | ✅ | Tests for both document formats; a real CIE photo check with a volunteer |
| Handoff reaches the owner's phone ≤ 60 s, agent stops on that thread | 🟨 built | Alert at the moment of handover to `ownerPhones`; needs Twilio configured and the approved template (`TWILIO_TEMPLATE_ESCALATION_ALERT`) |
| Demo from a clean tenant in < 20 min without a terminal | 🟨 | Script and `pnpm demo:reset` ready; two rehearsals by someone who did not build it |
| DPA template and guest privacy notice; notice on first contact | 🟨 | Notice ✅; DPA is a draft for counsel (`docs/legal/dpa-template.md`) |
| WP0.8: OpenTelemetry in every service | ✅ (ADR-036) | Traces, metrics and logs from all four services, verified end to end locally; backend account (Grafana Cloud EU or self-hosted) and dashboards still to set up (`docs/runbooks/observability.md`) |
| WP0.8: one UI for both consoles | ✅ | `packages/ui`, shared by `apps/web` and `apps/admin` |

| ADR | Decision | Built? | Where |
|---|---|---|---|
| 001 | Platform UUIDs; external systems via `external_refs` | ✅ as-built | Platform UUIDs everywhere; `external_refs` the only home for a foreign id; AuthorityMap + write-router in `src/authority` with both routes tested per domain (E6.2) |
| 002 | Fiscal core gated | ✅ as-built | Nothing fiscal exists, and the authority router refuses to grant the domain to the platform whatever a property row says — a row is data, so "we would never configure that" is not a control |
| 003 | Two deployables; worker is persistent | ✅ as-built · superseded by 030 | `apps/web`, `apps/worker`; constraint stated in the worker README. ADR-030 adds `apps/admin` as a third |
| 004 | Hono on `@hono/node-server` | ✅ as-built | `apps/api/src/app.ts` (in `apps/worker` until ADR-034) |
| 005 | pg-boss behind a `JobQueue` interface | ✅ as-built | `JobQueue` port in core, `PgBossQueue` the only file importing pg-boss. Verified live: enqueue to reflected in 780ms, against a 60s requirement |
| 006 | Supabase EU; Drizzle for domain access | 🟨 partial | Schema, access layer and Auth built on local Supabase. Cloud EU project not yet provisioned |
| 007 | RLS on every client-reachable table, tested in CI | ✅ as-built | 31/31 tables, 57 policies (counted by query 2026-09-27, `complaints` added in WP0.3), both suites green, negative control verified, and a CI job of its own. Counted by query against the database rather than by reading the schema — the row said 11/11 from Sprint 2 until Sprint 10 checked it. The public booking surface has no JWT to police, so it runs under `asService` with explicit scoping — asserted by handing each function the other property's ids (`booking.test.ts`) |
| 008 | Mock-first connector | ✅ as-built | `MockEricsoftAdapter` with counted failure injection, plus the shared contract suite the real adapter must pass before the swap. Verified by negative control: removing the idempotency guard fails the contract |
| 009 | Voice hard tool boundaries | 🟨 discipline applied to chat | Voice is WS-B. The *boundary* is built and measured here: every AG-01 tool returns a pre-formed `phrase`, the reply is that phrase verbatim, and a nightly job re-reads what was sent against the tool outputs of its own run. Zero violations is the gate |
| 010 | Stripe behind `PaymentAdapter` | 🟨 port built, **provider not connected** | `PaymentAdapter` + `MockPaymentAdapter`, which moves no money. The interface, policy engine, `payments` ledger, `fee_events`, webhook-as-authority, signature check, redelivery idempotency and lost-webhook replay are all real and exercised. Blocked on 04 §0 item 6 (Stripe account, Connect Standard, commercialista). A real adapter must pass `describePaymentAdapterContract` — the suite the mock passes — before the swap, and the worker refuses to boot simulated in production |
| 011 | Agents as first-class workers, tiered autonomy | ✅ as-built | Registry, runner and typed tools; AG-01, AG-05 and AG-07 live. The runner refuses an ungranted tool, scopes to one property, and records every run — including the ones that fail. AG-07 is the first agent that moves money, and it can only move it **down**: there is no tool that raises a fee, which is the asymmetry that makes a T1 agent near billing defensible |
| 012 | `LlmProvider` abstraction; no vendor SDK imports | ✅ as-built · amended by 029 | Interface and registry in `src/llm`; registration refuses a provider without declared EU processing — or ADR-029's recorded exception — a region, a verification under a year old, and a sub-processor register entry **that exists**. OpenRouter is the first concrete provider (`src/llm/openrouter.ts`, SP-006), registered at worker boot when `OPENROUTER_API_KEY` and the two model ids are set. Eslint bans `ai`, `@ai-sdk/*` and `@openrouter/*` outside `@bookone/core/llm` |
| 013 | Journey state machine is the single source of stay truth | ✅ as-built | Five dimensions, evented commands, `applyJourneyCommand` the only writer. Illegal transitions refused and separated from retries; every transition emits its event in the same transaction, so G1 is computable from the log alone. `journey_states` has no write policy at all — the console's arrival button will take the same command a door sensor will |
| 014 | Reference implementations over blank-page design | 🟨 as-built, **one note written late** | Seven notes in [design-notes/](../design-notes/README.md), all but one written before their surface; [pre-arrival.md](../design-notes/pre-arrival.md) records a Sprint 5 surface that shipped without one and says so at the top rather than being backdated. Three surfaces had no reference row in 08 §3 — in-stay messaging, the monthly report and the privacy desk — and each note proposes its own and argues the deviations. The table now carries all three |
| 015 | Pricing in €/room/month equivalence | ✅ as-built | On the monthly report, **including the percentage fees** — the number shown is the number billed. Null rather than a guess when the subscription records no room count: `room_types` holds types, not rooms, and a derived figure would be wrong and look authoritative on the one line built for comparison against a competitor's price |
| 016 | Property is a URL segment | ✅ as-built | `/[locale]/[property]/console/…`; verified in a browser that a non-member typing another slug gets a 404, not a redirect. Sprint 9 adds the same treatment for role: a staff member typing an owner-only URL gets 404, so "you are not a member" and "you may not see this" are indistinguishable from outside |
| 017 | Identity tables sit outside tenancy | ✅ as-built | `profiles` isolated by `auth.uid()`; asserted separately in the suite |
| 018 | RLS enforced on the Drizzle path via `withUser` | ✅ as-built | `packages/core/src/db/session.ts`; removing the role-drop fails 8 of 21 |
| 019 | Feature flags are entitlements, gated where the property is known | ✅ as-built (WP0.1 Part B) | `FEATURES` has the plan §2 keys that exist in code; `JOB_FEATURE` classifies every job, `ROUTE_FEATURE` every `/jobs/*` route, each agent declares its feature. Gates: worker middleware (404), gated `work()` wrapper, sweep queries filtered before the batch limit, per-property schedules re-synced every 10 min by `schedules.sync`, runner refusal recorded in `agent_runs`, `requireFeature` on console pages and actions, guest surfaces per section, nav from a pure `navBands`. Asserted as exact lists for all-off and Phase 0; negative control (both worker gates disabled) fails 11 tests; verified live: revoking `booking_engine` 404s `/book` on the next request, no restart. Per-tool gating arrives with profiles (WP0.2) — today every tool belongs to one agent |
| 020 | Statutory registration reporting is not fiscal core | ✅ decided, nothing to build | Scoping record. Imposta *collection* through payments still needs its own ADR before WP1.4 |
| 021 | One orchestrator, profiles as data, hard rules in code | ✅ as-built (WP0.2) | `packages/agents/src/orchestrator.ts`, `router/{hard-rules,route}.ts`, `profiles/*.json` validated at worker boot (a bad file stops the process, naming it). Allow-list refusal and approval holds are recorded, never executed. Sticky profile and unknown-twice read the thread's own runs (`recentRouting`), no migration. The emergency rule silences the agent until staff hand the thread back. WP0.3's action tools are stubs that **refuse** rather than return seeded data |
| 022 | The model selects; tools author every guest-facing sentence | ✅ as-built | Model calls are classification and tool selection only. Emergency and approval-pending texts come out of the `escalate` tool, so `reply ⊆ tool output` still holds on every turn and the tool-boundary audit is unchanged |
| 023 | AI SDK behind `LlmProvider`, no agent framework | ✅ as-built | `ai` 7 + `@openrouter/ai-sdk-provider` in core only. Tools stay in-process with JSON-schema inputs; the SDK never executes a tool. No MCP (ADR-034) |
| 029 | Stored data EU-only; model/vision processing may run outside the EU | 🟨 partial | SP-006 (OpenRouter) in the register as the recorded exception; `registerProvider` refuses a non-EU provider without it; requests set `zdr: true` and `data_collection: deny` (`packages/core/src/llm/openrouter.ts`). The guest privacy notice names processing outside the EU for messages and, when `document_ocr` is on, document photos (`stay.privacy.location`, four languages). The DPA draft names the transfer and its safeguards; counsel review pending. Reassess EU-only processing at production with paying properties |
| 030 | Three deployables; admin in its own container | superseded by 034 · admin part ✅ (WP0.8) | `apps/admin` exists, builds as a standalone container (`infra/docker/admin.Dockerfile`) and has no public port in `infra/vm/compose.yaml` (tailnet only). **Deviation:** the admin API is Next server actions inside `apps/admin`, not a separate Hono app — each action runs staff auth → role → `withAdminAudit`; Next checks the Origin of every action. Same boundary, one fewer server; revisit if a non-browser client ever needs the API |
| 031 | Operators act only through an audited console | 🟨 Phase 0 core ✅ (WP0.8) | `packages/core/src/admin`: `withAdminAudit` (role check, required reason, change + `admin_audit` row in one transaction), feature grant/revoke, the concierge kill switch, property list, audit trail, queue health. `admin_audit` append-only by trigger and with no client privileges. `apps/admin`: separate staff IdP (`ADMIN_SUPABASE_*`; production refuses the tenant project), role from `app_metadata.staff_role`, MFA (aal2) required in production, TOTP enrol/verify. View-as-tenant ✅: any staff role, reason required, the `tenant.view` audit row is the 30-minute grant, a read-only snapshot without message text or documents, and the property sees each access in its console settings (`support_access.started`). Not done: passkeys, daily export of `admin_audit` to immutable storage, the staff project itself (SP-009, planned) |
| 032 | Ops and security baseline, in priority order | 🟨 partial | Done: Stripe webhook verification + idempotency, webhook rate limit and 256 KiB body cap (`apps/api/src/rate-limit.ts`), retention/export/erasure, register (Tailscale, Hetzner, Infisical, staff project entered as `planned`), logical backup drill, container images and VM compose with Caddy exposing only `/webhooks/*` and `/health`, OpenTofu skeletons validated. Not done: Tailscale/Infisical actually provisioned, OTel backend account and dashboards (instrumentation done, ADR-036), PITR drill, host rebuild drill, signed images in CI, dependency scanning |
| 033 | Self-hosted until the first signed contract, then Cloud Run | 🟨 prepared (WP0.8) | `infra/vm` (compose, Caddyfile, Tailscale serve, `tofu/` for a Hetzner EU host with 80/443 only and Tailscale SSH) and `infra/gcp` (Artifact Registry, Secret Manager with per-service accessors, Cloud Run for api/worker/admin with internal ingress for worker and admin). Both `validate` clean from WSL. Nothing applied; no GCP project or CI deploy pipeline yet |
| 034 | `apps/api` split from the worker; worker jobs-only | ✅ as-built | `apps/api`: webhooks, health, `/jobs/*` and the feature gate, moved with history; producer-only pg-boss client (no supervision, no schedules). `apps/worker`: no HTTP. `PgBossQueue` moved to `@bookone/adapters/pg-boss`, still the only pg-boss importer. Mock payment intents live in the api process, so worker replay skips them in development; a real provider holds that state. Web config unchanged (`WORKER_URL` now points at the api). Rejected: JWT-only web, MCP server, package renames |
| 035 | WhatsApp and SMS go through Twilio, initially | 🟨 core path ✅ | `packages/adapters/src/twilio` (plain `fetch`, no SDK): client with delete-after-final-state, signature check, inbound/status parsing, `TwilioNotificationProvider` admitted only as the ADR-035 exception with SP-013. `packages/core/src/channels`: routing by the number written to, owner by `ownerPhones`, guests by exact E.164 on a current stay, idempotent on `MessageSid` via `external_refs`; pending-reply delivery for every writer. `apps/api` webhooks, worker jobs (`channel.deliver/sweep/unmatched/purge`, `owner.message`), features `whatsapp` and `sms`. Owner handover alert to `ownerPhones` at the moment of handover (plan §4, ≤ 60 s), through the outbox, as the approved template when `TWILIO_TEMPLATE_ESCALATION_ALERT` is set. Not built: the pre-arrival invitation template, per-property sender numbers, pre-sale threads without a reservation, replayed WhatsApp conversations in `test:evals`. Runbook: `docs/runbooks/whatsapp.md` |
| 036 | Every service emits OpenTelemetry traces, metrics and logs | ✅ as-built | `packages/telemetry` (SDK start, redacted and trace-correlated pino logger, URL scrubbing exporter), `@bookone/core/telemetry` (job and GenAI spans, lazy metrics), api server-span middleware, Next `instrumentation.ts` in web and admin, trace context carried through pg-boss. Collector config with content and URL stripping (`infra/otel/collector.yaml`), local LGTM stack, VM collector, GCP endpoint variable. A test fails if an app's entry point does not start it. Not done: Phoenix, tail sampling, dashboards and alerts |
| 024 | Replay conversations extend the evals gate | ✅ as-built (WP0.2) | 57 conversations in `packages/agents/src/evals/conversations/wp0.2/`, replayed by `evals/wp0.2/orchestrator.eval.ts`: unsafe actions 0 (gate), routing ≥ 90%, hard-rule negatives. Negative control: disabling the hard rules fails 13. The rules score is coverage, not generalisation. **Live, 2026-09-27** (Haiku 4.5 routing, Sonnet 5 actions, via OpenRouter): 85.7% on the first run — invoice/luggage sent to payments, "which documents" flagged as identity — then **100%, 0 unsafe** once the routing prompt carried each profile's description and sharper flag definitions. 35 routed turns written by us: evidence the design works on a model, not a measure of real traffic. Phoenix not yet |
| 025 | Workflow engine deferred until a named trigger | Proposed | Decided in Phase 1 on observed evidence |
| 026 | ComplianceAdapter with a manual fallback | ⬜ Phase 1 (WP1.1) | `AlloggiatiAdapter` becomes its first implementation |
| 027 | BookOne never asserts identity; de visu staff-assisted | ✅ holds (nothing asserts identity); module ⬜ Phase 3, gated | Gate: Viminale guidelines + written legal opinion |
| 028 | Region-first expansion, region registry | ⬜ Phase 1 (WP1.1) | FVG first |

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
| **A language model** | ✅ **connected in development** | OpenRouter under ADR-029: `anthropic/claude-haiku-4.5` (small), `anthropic/claude-sonnet-5` (strong), ZDR endpoints only. Registers at worker boot through the residency gate. Demo data only until the transfer assessment (ADR-029) |
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

## Guest Desk WP0.3 — real actions

| Thing | Status | Note |
|---|---|---|
| Desk tools | ✅ | `check_availability`/`quote_stay` (rate cache; stale → a person, never "nothing free"), `create_booking_link` (only with `booking_engine`), `modify_booking` (checked against availability, **recorded as a task for a person**, never written to the booking), `get_payment_status`, `explain_charges`, `send_prearrival_link`, `record_eta` (through the journey machine), `get_capture_status`, `request_late_checkout`, `request_invoice` (routed; we issue nothing, D11), `log_complaint`, `notify_owner`, and the owner's four read-only lists. Every phrase from rows, in four languages |
| `complaints` table | ✅ | Category, SLA from the database clock (5 min safety, 30 otherwise), owner alerted on logging, no member delete. Both access paths verified by query; negative control failed the isolation test |
| Write idempotency | ✅ | thread + tool + canonical input hash, recorded on the call in `agent_runs.tool_calls`; a repeat returns the earlier output and is marked `replayed`. Negative control: bypassing the lookup logs a second complaint |
| Handoff | ✅ | A tool may answer and still hand to a person (`handoff: true`): date changes, late checkouts, complaints — T2 |
| Tool-boundary audit, hardened | ✅ | Evidence is now **what tools returned**, not the run's recorded reply (which made every reply sourced by definition) and not tool inputs; multi-phrase replies checked paragraph by paragraph. Verified on the real reply path: zero violations |
| `cancel_booking`, `create_payment_link` | ⬜ WP0.6 | Approval-held, so they run from the approval step; and the mock payment adapter's intents live in `apps/api` (ADR-034) |
| Owner notified by WhatsApp | ⬜ | Email through the outbox today (`alertEscalation`); WhatsApp templates wait on the BSP |
| `knowledge_chunks` + pgvector | ⬜ **not built, deliberately** | The spec's hybrid search needs an embedding provider (another sub-processor) and duplicates `kb_articles`, which already has an editor. Revisit when the knowledge base outgrows keyword matching — the eval set will show it |
| Agents database suite | ✅ | `packages/agents` `test:rls` (15 tests) in CI's `rls` job, after core's (turbo `^test:rls`); own property, never truncates |

## Guest Desk WP0.4 — pre-arrival capture

| Thing | Status | Note |
|---|---|---|
| MRZ (TD1, TD3) | ✅ | ICAO 9303 check digits in TypeScript, tested on ICAO specimens; a miscounted `<` run is corrected (never a character) and the digits still decide — the exact miscount a vision model made live |
| Schedina preview | ✅ | `buildPayload` cut back into its fields: staff see what would be filed, not a second rendering |
| Staff "Conferma" | ✅ | `documents.validate` + `validated_at`, refused unless complete with a document per guest. Verified in a browser end to end |
| Consent | ✅ | Before the first document, once per stay, as a domain event with the notice version; beside a **draft** guest privacy notice (four languages) that needs the property's counsel |
| Document deletion without Alloggiati | ✅ | `documentRetentionDays` (default 1) after departure. Before this, images of a property that files elsewhere were kept indefinitely. Negative control verified |
| OCR | ✅ behind `document_ocr` | Vision model via OpenRouter reads the photo; MRZ fields win when their digits agree; everything else low-confidence; stored beside the typed data, mismatches shown to staff, unreadable photos prompt a retake. **Off by default** — ADR-029: a real guest's document waits for the transfer assessment. Live on a synthetic ICAO specimen: 5.3 s, MRZ valid after filler repair |
| PDFs | ⬜ | Stored and filed as before; not read by the model, which reads images |
| `capture_sessions` / `guest_identity_documents` | ⬜ **not built, deliberately** | The spec's tables duplicate `journey_states` + `registration_records` + the private bucket; the inventory chose to extend |

## Guest Desk WP0.5 — demo property and owner agent

| Thing | Status | Note |
|---|---|---|
| `pnpm demo:seed` | ✅ | Fictional "Hotel Demo Trieste": 25 stays through the domain's own commands (5 departed, 4 in the house, arrivals in every pre-arrival state, 11 future), 13 knowledge articles IT/EN from `content/demo/kb.json`, 2 open complaints, owner and staff logins. Re-runnable; removes only the demo property |
| Demo features | ✅ | Phase 0 set + `pms_sync` (mock PMS, so availability exists) + `booking_engine` (so pre-sale can hand out a link — the matrix has it off for hotels; the demo needs it) + `document_ocr` (demo documents only). `alloggiati` off |
| Knowledge golden set | ✅ | 21 IT/EN questions reach the right article; four adjacent ones reach none. Its first run found a real near miss — a pool question answered with the seafront — fixed with content, not the matcher |
| Owner agent (AG-06) | ✅ | `owner-backoffice` profile for recorded owner numbers only (`settings.ownerPhones`); a guest's number is refused before anything runs. Verified live: arrivals, missing documents, open complaints |
| Owner reached by WhatsApp | ⬜ | `respondToOwner` is the entry point; the channel waits on the BSP |
| `knowledge_chunks` / embeddings | ⬜ deliberately | See WP0.3 |
| AG-02 (document extraction) in `agent_runs` | ⬜ | 06 names extraction AG-02. It runs as the `documents.extract` job, audited by `document.read` events; routing it through the runner would put the image or identity fields in `agent_runs`. Decide how to record it before the model sees a real document |

## Guest Desk WP0.6 — the inbox

| Thing | Status | Note |
|---|---|---|
| Approvals | ✅ | Console page listing what the concierge held (`agent_runs.outcome` null). Approve carries it out, then records the decision once (`outcome`, `reviewed_by`, `approval.decided`) and tells the guest in their language; reject always sends the guest a reply. Verified in a browser: German guest, Italian owner, confirmation delivered |
| Runs that hold an action | ✅ fixed | They were recorded `outcome: auto`; now null until a person decides, which is what lists them |
| Actions in the thread | ✅ | Per reply: each tool, its status and the decision on held ones |
| "Annulla" | ✅ where real | Cancels the task a date change or late checkout created, once, as its own event linked to the run. Links sent and emails delivered have no undo, and no button pretends otherwise |
| "Prendo io" silences the agent | ✅ | And a pre-existing bug fixed: taking over a thread nobody had escalated violated `message_threads_escalated_has_time` — a 500 on the button. Regression test in core |
| Hard rule shown to staff | ✅ | The rule that last handed the thread over, in the stay card |
| Complaint SLA | ✅ | Deadline and overdue state in the thread; `complaints.sla` sweep (every 2 min, filtered by feature in its query) alerts the manager once via `breach_alerted_at` (additive migration) |
| `cancel_booking` on approval | ✅ | Through the api's cancel, which applies the refund policy |
| `create_payment_link` on approval | 🟨 | Calls the booking flow's checkout, which refuses a confirmed stay; staff see the reason. A balance link for an existing booking needs the real payment provider |
| Owner handoff on WhatsApp within 60 s | ⬜ | Email today; the channel waits on the BSP |
| Realtime | ⬜ | Supabase Realtime is off in this repo's local setup; pages refresh on action |

## Guest Desk WP0.7 — demo collateral

| Thing | Status | Note |
|---|---|---|
| Demo script | ✅ | [docs/demo/script.md](../demo/script.md): 12 steps, 20 minutes, no terminal during the run; maps each step to plan §4 and says what the demo does not show |
| Roadmap slide, one-pager (IT) | ✅ | [roadmap-slide.md](../demo/roadmap-slide.md), [one-pager.it.md](../demo/one-pager.it.md). "EU-hosted", never "EU-processed" (ADR-029); no fiscal or identity claims |
| `pnpm demo:reset` | ✅ | ≈ 4 s, against a 30 s target |
| Owner's assistant in the console | ✅ | Owner-only "Assistente" page: the session is the identity (`requireOwner`), the question runs AG-06 through the worker, the answer is read back from the run. How the demo reaches the owner agent without WhatsApp |
| Rehearsal by someone who did not build it | ⬜ | WP0.7 AC — twice, from reset, under 20 minutes |
| DPA template | 🟨 draft | [docs/legal/dpa-template.md](../legal/dpa-template.md): the Commission's 2021/915 clauses with annexes completed from the code (data map periods, TOMs with where each lives, the generated register as the sub-processor annex) and six open questions. **Needs counsel before any hotel signs it** |

## Guest Desk WP0.8 — admin and ops foundation

| Thing | Status | Note |
|---|---|---|
| `admin_audit` | ✅ | Append-only by trigger (UPDATE, DELETE, TRUNCATE raise, even on the service connection); `revoke all` from `anon`/`authenticated` because Supabase's default grants include TRUNCATE; in the data map; isolation verified by query with a negative control (policy map) |
| Audited operations | ✅ | `packages/core/src/admin`; `grantEntitlementIn` / `revokeEntitlementIn` run inside the audit transaction, so the change, its domain event and its audit row commit together. Tests: `rls/admin.test.ts` |
| Concierge kill switch | ✅ | `properties.settings.agentPausedAt`, read per turn: the guest gets the `paused` phrase as a system message, the thread is escalated, no model call and no agent run. Tested in `inbox.db.test.ts` |
| `apps/admin` | ✅ | Properties, features with reasons, pause/resume, audit trail, queue health (pg-boss tables). Local operators: `ops@bookone.test` (admin), `support@bookone.test` (read-only), from `pnpm db:seed` |
| Webhook rate limit | ✅ | Per-client fixed window before the signature check; `TRUST_PROXY` only behind Caddy/Cloud Run |
| Containers + compose | ✅ | api and admin images built and smoke-tested locally; the worker uses the same Dockerfile as the api |
| OpenTofu skeletons | ✅ | Validated with Terraform 1.15 from WSL (OpenTofu is not installed there yet; the HCL is compatible) |
| View-as-tenant | ✅ | `startTenantView` / `activeTenantView` / `tenantSnapshot`; the admin page redirects outside the window; the owner's settings page lists every access with operator, reason and end time (RLS on `domain_events`). Tests in `rls/admin.test.ts` |
| Host rebuild drill | ⬜ | Written in `backup-restore.md`; ADR-033 makes it a precondition for pilot data |

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
