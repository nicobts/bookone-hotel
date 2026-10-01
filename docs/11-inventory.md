# 11 — Guest Desk inventory (WP0.1 Part A)

As of 2026-09-27, HEAD `31c6fdd`. Read-only pass: nothing was changed to produce this file.
Source of the rows: `docs/guest_desk_20260927/bookone-guest-desk-handoff/docs/10-guest-desk-plan.md` §2.
Paths are relative to the repo root. `schema.ts` means `packages/core/src/db/schema.ts`;
`handlers.ts` / `schedules.ts` / `app.ts` are under `apps/worker/src/`.

**Headline.** The handoff was written against a generic single-app layout (`src/agent/…`, `src/mcp/…`,
"existing ChannelAdapters"). This repo is a monorepo with its own binding rules and 18 ADRs, and several
handoff assumptions are false here. Section 3 lists what needs deciding before any Part B code; section 4
proposes the re-baseline.

---

## 1. Flag-matrix rows

| # | Module (plan §2) | Phase 0 target | Status | Evidence |
|---|---|---|---|---|
| 1 | Communication Hub inbox | ON | 🟨 partial | Threads, escalation, takeover, SLA alert exist; no multi-channel, no per-action log, no reversal, no T2 approval surface |
| 2a | Channel: webchat | ON | ✅ exists | Stay-page thread only |
| 2b | Channel: email forwarding (inbound) | ON | ⬜ missing | No inbound route or parser |
| 2c | Channel: WhatsApp | ON | ⬜ missing | Enum value only; BSP verification blocked (04 §0) |
| 2d | Channel: OTA messaging | OFF | ⬜ missing | — |
| 2e | Channel: voice | OFF | ⬜ missing | ADR-009 discipline only |
| 3 | Orchestrator + profiles (ADR-F1) | ON | 🟨 partial, **different shape** | Static registry + deterministic AG-01; no profiles, no router hard rules, no model |
| 4 | Guest profile / dual-source store | ON | 🟨 thin | `guests` row matched by email; no PMS→guest merge |
| 5 | Ericsoft sync | per pilot | 🟨 mock + full engine | No real adapter (WS-C blocked) |
| 6 | Stripe Connect | ON (test) | 🟨 port only | `PaymentAdapter` + mock; **no Stripe code, no Connect** |
| 7a | Booking engine | OFF for hotel tenants | ✅ exists | `/book/[property]` |
| 7b | Restaurant booking | per tenant | ⬜ **does not exist** | ADR-F7's "remains ON for restaurant tenants" is false here |
| 8 | Pre-arrival capture | ON | 🟨 partial (substantial) | Stay page, uploads, T-48h invite, journey states exist; no OCR/MRZ, no schedina preview, no staff-confirm caller, no consent record |
| 9 | Alloggiati Web submission | OFF | 🟨 built behind a mock | Auto-files on arrival **today** (to the mock) — must go dark for Phase 0 |
| 10 | ISTAT regional (WebTur FVG) | OFF | ⬜ missing | Docs only |
| 11 | Tassa di soggiorno engine | OFF | 🟨 display note only | Per-property policy + quote note; no engine |
| 12 | Compliance dashboard | OFF | ⬜ missing | Nearest: Exceptions inbox `alloggiati-overdue` |
| 13 | Identity verification (de visu) | OFF | ⬜ missing | — |
| 14 | Rooms / IoT | OFF | 🟨 interface only | `stay/door.ts` port, "Nothing implements this" |
| 15 | Fiscal core (D11) | OFF | ✅ absent and guarded | Authority router refuses `fiscal` |
| — | Owner back-office agent | ON | ⬜ missing | Only in handoff files |

### Row detail

**1. Communication Hub.**
Tables: `message_threads` (`schema.ts:1438`, unique on `reservation_id`), `messages` (:1504), `stay_tasks` (:1561), `kb_articles` (:1372) — migration `20260828232438_flaky_hawkeye.sql`, RLS `20260828232439_messaging_rls.sql`.
Domain: `packages/core/src/concierge/thread.ts` (`escalateThread` :325, `takeOverThread` :388, `handBackThread` :424, `listOverdueEscalations` :527).
Jobs: `escalation.sweep` (`handlers.ts:466`, `*/5`) → email via outbox; `toolboundary.audit` (`handlers.ts:620`, 05:00) logs only.
UI: `apps/web/src/app/[locale]/[property]/console/conversations/` (+ `[thread]/actions.ts`: `takeOver`, `handBack`, `reply`); nav `apps/web/src/components/shell/app-sidebar.tsx:83`.
Gaps: T1/T2/T3 is only the agent's declared tier (`packages/agents/src/runner.ts:128`); `agent_runs.outcome` is only ever `'auto'`; `agent_runs.tool_calls` stores `{tool, ok}` — no input/output, no `reversible`/`reversed_by`; staff and agent replies never leave the platform (guest reads them on the stay page).

**2. Channels.**
Inbound path that exists: `stay/[token]/actions.ts:200` → `apps/web/src/lib/worker.ts:381` → `POST /jobs/guest-message` (`app.ts:470`) → `concierge.reply` (`handlers.ts:434`) → `packages/agents/src/concierge.ts`.
Outbound port: `packages/core/src/notifications/provider.ts` (`NotificationProvider`, residency-gated), outbox `notifications/outbox.ts`, only impl `apps/worker/src/notifications/log-provider.ts` (log mock, email).
**There is no ChannelAdapter anywhere**, inbound or outbound-conversational. `message_threads.channel` reuses `notification_channel` (email|sms|whatsapp, default `'email'`) — there is no `web` value although web is the only live channel.

**3. Orchestrator.**
Registry `packages/agents/src/registry.ts` (AG-05 :56, AG-01 :98, AG-07 :144, AG-03 :183; all `model: 'none'`, budget 0); tools `packages/agents/src/tools/{index,concierge,billing,onboarding}.ts` (in-process `Tool`, no schemas); runner `runner.ts` (`runAgent` :90, grant check `callTool` :155, per-agent `switch` :192).
AG-01 is a deterministic ladder (`packages/core/src/concierge/intent.ts`): request → task + escalate; KB hit → relay tool `phrase` verbatim; else escalate.
LLM port `packages/core/src/llm/{provider,registry}.ts` — **zero providers registered**; eslint bans vendor SDKs outside `@bookone/core/llm` (`eslint.config.mjs:39-51`).
Evals: `packages/agents/src/evals/{ag-01,ag-05}` as vitest, `pnpm test:evals`, a merge gate.
No `ai`, `@ai-sdk/*` or `@modelcontextprotocol/sdk` dependency anywhere. `zod ^4` present.

**4. Guest store.** `guests` (`schema.ts:396`), sole writer `upsertGuest` (`packages/core/src/booking/confirm.ts:390`) keyed on (property, email). Sync writes only reservation `external_refs`. Console Guests page is a `NotBuiltYet` placeholder.

**5. Ericsoft.** Port `packages/core/src/adapters/pms.ts`; mock `packages/adapters/src/mock-ericsoft/`; contract `packages/adapters/src/pms/contract.ts`; sync `packages/core/src/sync/{availability,reflect,reconcile}.ts` (booking domain only). Jobs `availability.refresh` (`*/2`, per property), `reconcile.nightly` (03:30, per property → AG-05), `reservation.reflect`. Routes `GET /health/connector`, `POST /jobs/reservation-reflect`. UI: Exceptions inbox.

**6. Payments.** Port `packages/core/src/payments/adapter.ts`; mock `packages/adapters/src/mock-payment/`; contract `packages/adapters/src/payment/contract.ts`; ledger `payments` + `fee_events` (`20260828185420_narrow_patriot.sql`). Routes `POST /webhooks/payments`, `GET /health/payments`, `/jobs/cancel`, `/jobs/cancellation-quote`, simulation-only `/jobs/payment-intent` + `/jobs/payment-simulate` (runtime 404, **registered regardless** — see §2). Job `payment.replay` (`*/2`). Web `apps/web/src/app/pay/[intent]/page.tsx` (simulated checkout). "Stripe test mode" = `allowSimulation = NODE_ENV !== 'production'`.

**7. Booking.** `apps/web/src/app/[locale]/book/[property]/` + `manage/[reservation]/`; core `packages/core/src/booking/*`; gated by `resolveAuthority(…,'booking')` (`booking/hold.ts:80`). Restaurant: no code.

**8. Pre-arrival capture.** Page `apps/web/src/app/[locale]/stay/[token]/page.tsx` (`submitParty`, `uploadDocument`, `submitArrivalTime`, …); HMAC token `packages/core/src/journey/token.ts`; domain `journey/precheckin.ts`; storage `apps/web/src/lib/storage.ts` + `packages/core/src/storage/documents.ts` (private bucket `identity-documents`); machine `journey/machine.ts` (precheckin pending/invited/submitted; documents pending/captured/validated/deleted). Jobs `precheckin.sweep` (hourly :07) → `precheckin.invite`; `documents.purge` (hourly :23, **after Alloggiati acknowledgement**). Staff view `console/arrivals/[reservation]/` (`validateParty`, missing-field list).
Gaps vs WP0.4: no OCR, no MRZ; the party form is typed by hand; no schedina *preview* (only validation issues + checksum); `documents.validate` command has **no caller outside tests** (no "Conferma"); no consent record; deletion is tied to Alloggiati acknowledgement, not "N days after checkout" — with Alloggiati OFF, **images would never be deleted by the purge job** (retention sweep is the only backstop).

**9. Alloggiati.** Record builder `packages/core/src/alloggiati/record.ts` (168-char layout, header "VERIFY BEFORE PRODUCTION"; `mapCountryCode` is identity — no code tables); `alloggiati/submit.ts`; port `alloggiati/adapter.ts`; mock `packages/adapters/src/mock-alloggiati/`; contract `packages/adapters/src/alloggiati/contract.ts`; table `alloggiati_submissions` (`20260828220244_steep_viper.sql`). Triggers: `POST /jobs/arrival-confirm` enqueues `alloggiati.file`; `POST /jobs/alloggiati-submit` (staff "file now"); `alloggiati.check` (`*/10`). Overdue: exceptions item at 20h (`db/queries/exceptions.ts:50`), no push.
**The schedina model WP0.4 asks for already exists** as `validateParty` + `buildPayload`; a preview is a render of it.

**11. Tassa.** `packages/core/src/booking/quote.ts:132-200` (`touristTaxNote`, policy in `properties.settings.touristTax`), shown on booking review. `docs/design-notes/booking-flow.md` §D: the tax is a note, not a line in the online total — conflicts with WP1.4 "collected via the payments profile".

**14. Rooms/IoT.** `packages/core/src/stay/door.ts` (port + checklist), `stay/arrival.ts:42` accepts `source:'door'`.

**15. Fiscal.** `packages/core/src/authority/index.ts` — `NEVER_PLATFORM = ['fiscal']`, `FiscalAuthorityError`; `invoice_requests` records and routes, issues nothing.

---

## 2. Registration points (where a flag would have to act)

**Existing flag mechanism — `entitlements` (E7.3).** `schema.ts:1997-2039`; migrations `20260829095025_living_professor_monster.sql` + `20260829095026_entitlements_rls.sql` (member SELECT only, writes service-role only). Core `packages/core/src/onboarding/entitlements.ts`: `FEATURES = ['concierge','rooms','reporting']` (:29), `isEntitled` (:47), `grantEntitlement` (:58, emits `entitlement.granted`), `revokeEntitlement` (:113, ends the row, never deletes). Per property, fail-closed, no redeploy. **No production caller of `isEntitled`** — it is displayed on `console/setup` and gates nothing.

This already satisfies the shape of the handoff's `tenant_features` (tenant = property; history kept; evented). A second flag table would be two sources of truth.

| Surface | Where | Registered | Per-tenant gating possible at… |
|---|---|---|---|
| Hono routes | `app.ts` `createApp` :41, one chain from :87 (kept chained for `AppType` RPC, rule 10) | once, at boot; tenant arrives in the body | request time only (guard → 404). "No route registered" per tenant is not achievable in one process serving many tenants |
| pg-boss handlers | `handlers.ts` `registerHandlers` :145 (24 jobs); queues created for every `jobNames` entry (`packages/core/src/jobs/queue.ts:22`) | once, global | inside each handler / sweep loop |
| Per-property schedules | `schedules.ts:172-223` (`reconcile.nightly`, `availability.refresh`, `retention.sweep`), keyed + pruned | at boot; new property needs restart | at schedule time (filter the loop) — but toggling then needs a restart, violating "no redeploy" unless re-synced periodically |
| Global sweeps | `schedules.ts:228-239` (12 keyless crons) | once | inside the sweep, per property |
| Agents / tools | `packages/agents/src/registry.ts:192` static Map; `tools/index.ts:103` static record; grant check `runner.ts:155` | module constants | in `runAgent` / `callTool` (`ToolContext.propertyId` is there) |
| Web routes | file-system, static at build | build time | `notFound()` guard in layout + page + **every server action** (pattern: `requireOwner`, `apps/web/src/lib/auth/current-property.ts:71`) |
| Console nav | `app-sidebar.tsx:76-131`, server component per request | per request | per request (already filters by role) |

Precedent to note: `/jobs/payment-intent` and `/jobs/payment-simulate` are commented as "never registered" but are registered and 404 at runtime (`app.ts:597`, `:699`). That is exactly ADR-F2's "leaking flag" — and it is the only achievable shape for per-tenant HTTP gating here.

---

## 3. Conflicts that need a decision before Part B

Each of these is either a binding-rule conflict (CLAUDE.md says stop and write an ADR) or a false premise in the handoff.

1. **Where the code lives.** No root `src/`. Proposed mapping: profiles + router → `packages/agents/src/{profiles,router}/`; prompts → `packages/agents/src/prompts/` (already exists); tools stay in `packages/agents/src/tools/`; `features.ts` → `packages/core/src/onboarding/` next to entitlements; `policy.ts` → existing `packages/core/src/policy/`; capture page → the existing `/stay/[token]`; demo seed → `scripts/seed-demo.mts` alongside `seed-dev.mjs`.
2. **Flags: extend `entitlements`, don't add `tenant_features`.** Widen `FEATURES` to the §2 keys. No migration needed (column is free text). "Off means absent" becomes "off means 404 / not scheduled / not granted" — ADR-F2 wording must accept request-time gating, because per-tenant route *registration* is impossible in a shared process.
3. **ADR numbering.** F1–F9 go into the main log as ADR-019…027 (write-adr skill: next number, README row, IMPLEMENTATION-STATUS row). CLAUDE.md's "16 ADRs" is already stale (18 exist).
4. **Model-authored replies vs binding rule 7 / ADR-009 / the tool-boundary audit.** WP0.2 has the model generate text. Today every reply must be a tool `phrase` verbatim and `toolboundary.audit` flags anything else (`packages/core/src/concierge/audit.ts`). Needs an ADR: either the model only selects tools and the reply stays the phrase (keeps the audit), or the audit is relaxed to "every fact/number sourced". This is the single most consequential decision in Phase 0.
5. **Vercel AI SDK vs ADR-012.** ADR-012 makes `LlmProvider` the only path to a model, with residency + sub-processor gating, lint-enforced. Recommended: AI SDK sits *behind* `LlmProvider` inside `@bookone/core/llm`, and the eslint ban is extended to `ai` / `@ai-sdk/*` elsewhere. Adding `ai` is a dependency → stop-and-ask. Also: no provider passes D9 yet (04 §0) — WP0.2's live routing is blocked on that external decision, not on code.
6. **MCP server vs in-process tools (ADR-011).** Existing tools are in-process with grant checks and `ToolContext` property scoping ("absence is the control"). An MCP transport in-process adds a dependency and a second registry for no Phase 0 gain; Phase 4 voice is the only consumer that needs it. Recommend: keep the `Tool` registry, add zod input schemas per tool (which AI SDK needs anyway), defer MCP to the voice ADR.
7. **Channels do not exist.** ADR-F9 layer 7 assumes "existing ChannelAdapters". Inbound email, WhatsApp and a ChannelAdapter port are all new work, and WhatsApp is blocked on BSP verification. Threads are unique per `reservation_id` (NOT NULL) — pre-sale threads with no reservation need a **schema migration**. WP0.1–0.3 estimates did not include any of this.
8. **Pre-arrival: extend, don't rebuild.** WP0.4's `capture_sessions` / `guest_identity_documents` duplicate `journey_states` + `registration_records` + the `identity-documents` bucket. Real gaps: MRZ (`mrz.ts`), OCR (needs an EU vision provider — same D9 block), schedina preview (render of existing `buildPayload`), a caller for `documents.validate` ("Conferma"), consent record, and a checkout-based retention rule so images are deleted when Alloggiati is OFF.
9. **Alloggiati must go dark in Phase 0.** Currently `arrival-confirm` always enqueues `alloggiati.file`. With the flag OFF, filing must stop *and* document deletion must no longer depend on acknowledgement (item 8).
10. **Tassa vs fiscal gate and booking-flow §D.** Not named in ADR-002/D11 (07-COMPETITIVE-ANALYSIS already calls it "safely outside the Rung 6 gate"), but "collected via payments" contradicts design note §D and puts a tax into the `payments` ledger. Needs its own ADR in Phase 1; no Phase 0 impact.
11. **Restaurant booking does not exist.** ADR-F7 should say so rather than keep it "ON for restaurant tenants".
12. **Stripe "ON (test)" is not a flag flip.** There is no Stripe adapter; `create_payment_link` in WP0.3 needs `StripePaymentAdapter` passing the contract suite, blocked on 04 §0 item 6. Phase 0 demo can use the mock (visible "simulated" notice).
13. **Evals.** Handoff wants `evals/<wp>/*.json` + `scripts/replay-evals.ts` + Phoenix; repo has vitest evals under `packages/agents/src/evals/` wired into a merge gate. Recommend: keep the vitest gate, add the JSON conversation format as fixtures it loads. Phoenix is a new sub-processor/self-host → register entry first (D9).
14. **Demo seed.** Sprint 9 deliberately did not build a demo-mode toggle. A separate `seed-demo` for a dedicated demo property is compatible with that; a toggle inside a real property is not.

---

## 4. Proposed re-baseline

| WP | Handoff est. | Re-baselined | Why |
|---|---|---|---|
| WP0.1 Part B | 3–5 d | 2–3 d | Reuse `entitlements`; no migration. Gates in: runner/`callTool`, handler sweeps, per-property schedule loop (+ periodic re-sync), `requireFeature` web guard, nav filter, `/jobs/*` guard. Snapshot tests on a fake `JobQueue`, `app.routes` + guard, nav builder |
| ADRs | — | 1–2 d | 019–027 from F1–F9, amended per §3 items 2, 4, 5, 6, 11 |
| WP0.2 | 5–7 d | 6–8 d, **model part blocked on D9 provider** | Router + hard rules + profiles-as-data are buildable deterministically now; LLM routing needs a registered provider |
| **New: channels** | not in plan | 5–8 d + BSP | ChannelAdapter port, inbound email, WhatsApp (blocked), thread-without-reservation migration |
| WP0.3 | 5–7 d | 6–9 d | Per-action log table (migration) + reversal; Stripe blocked → mock |
| WP0.4 | 5–7 d | 4–6 d | Extends existing pre-arrival; OCR blocked on EU vision provider, MRZ/preview/confirm/consent/retention are not |
| WP0.5 | 3 d | 3–4 d | Seed-demo + KB content; `knowledge_chunks`/pgvector is a new table + extension (migration) vs existing `kb_articles` — decide |
| WP0.6 | 3–5 d | 4–6 d | T2 approval surface does not exist yet (Sprint 9 named it as the missing prerequisite) |

External blockers that decide the demo, none of them code: ~~EU LLM provider~~ and ~~EU vision/OCR provider~~ — resolved by ADR-029 (OpenRouter; storage stays EU, processing may run outside it; reassessed at production); WhatsApp BSP (owner is checking options); Stripe account (owner is handling).

## 5. Decisions taken (2026-09-27)

| §3 item | Decision | Record |
|---|---|---|
| 1 | Paths mapped into the monorepo as proposed | ADR-021, ADR-024 |
| 2 | Extend `entitlements`; off = unreachable for that property, not unregistered | ADR-019 |
| 3 | F1–F9 recorded as ADR-019…028 | [adr/README.md](adr/README.md) |
| 4 | The model selects; tools author every guest-facing sentence; audit unchanged | ADR-022 |
| 5, 6 | AI SDK behind `LlmProvider`; tools stay in-process with zod schemas; MCP deferred to voice | ADR-023 |
| 10 | Imposta reporting is in scope; collection needs its own ADR before WP1.4 | ADR-020 |
| 11 | No flag key for restaurant booking until it exists | ADR-019 |
| 13 | Conversations are fixtures of the existing evals gate | ADR-024 |

Later, 2026-09-30: imposta collection (item 10) is decided by ADR-044. The table above stays as it
stood on 2026-09-27.

Still open: item 7 (channels WP and the thread-without-reservation migration), item 8 (WP0.4 scope as
"extend"), item 12 (Stripe mock for the demo), item 14 (demo seed), and the external blockers in §4.
WP0.1 Part B is done (ADR-019 row in IMPLEMENTATION-STATUS). Found while building it, for the next WPs:

- **Pre-sale needs the booking engine the matrix turns off.** WP0.3's `create_booking_link` links to the booking engine, which the matrix has OFF for hotel properties. The demo property needs `booking_engine`, or pre-sale links to a payment link only. Decide in WP0.3.
- **`booking_engine` without `payments` is a misconfiguration.** A property with a deposit policy gets a 404 from `/jobs/checkout` at step 4. Nothing prevents granting one without the other yet.
- **Document deletion still waits for Alloggiati acknowledgement.** With `alloggiati` off, `documents.purge` never fires for new stays; the retention sweep is the only backstop. WP0.4's checkout-based retention rule closes this.
- **Returning from payment after a revoke.** A guest coming back from the provider to a property whose `booking_engine` was just revoked sees a 404; the webhook still confirms the booking. Edge case, accepted.
