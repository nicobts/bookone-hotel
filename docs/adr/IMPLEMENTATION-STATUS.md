# Implementation status

A decision recorded is not a decision shipped. This table is the gap.

Update it in the same PR that changes the answer — a status file that lags is
worse than none, because it is read as current.

| ADR | Decision | Built? | Where |
|---|---|---|---|
| 001 | Platform UUIDs; external systems via `external_refs` | ✅ as-built | Every table keys on a platform UUID; `external_refs` is the only home for a foreign identifier |
| 002 | Fiscal core gated | ✅ by construction | Nothing fiscal exists. Enforced by absence, not by a check |
| 003 | Two deployables; worker is persistent | ✅ as-built | `apps/web`, `apps/worker`; constraint stated in the worker README |
| 004 | Hono on `@hono/node-server` | ✅ as-built | `apps/worker/src/app.ts` |
| 005 | pg-boss behind a `JobQueue` interface | ⬜ not yet | Dependency installed; wiring is Sprint 2 |
| 006 | Supabase EU; Drizzle for domain access | 🟨 partial | Schema and access layer built; running against local Supabase. Cloud EU project not yet provisioned |
| 007 | RLS on every client-reachable table, tested in CI | ✅ as-built | 10/10 tables, both suites green, negative control verified. Not yet *in* CI — that is day-1 task 5 |
| 008 | Mock-first connector | ⬜ not yet | `packages/adapters` scaffolded; day-1 task 4 |
| 009 | Voice hard tool boundaries | ⬜ WS-B | Not this workstream |
| 010 | Stripe behind `PaymentAdapter` | ⬜ not yet | Sprint 4 |
| 011 | Agents as first-class workers, tiered autonomy | 🟨 partial | `agent_runs` exists and is policed (no session insert — a human-recorded run would be a forged audit entry). Runner is Sprint 2 |
| 012 | `LlmProvider` abstraction; no vendor SDK imports | 🟨 partial | The prohibition is enforced now by `no-restricted-imports` in `eslint.config.mjs`; the interface itself is day-1 task 3 |
| 013 | Journey state machine is the single source of stay truth | ⬜ not yet | Sprint 2 |
| 014 | Reference implementations over blank-page design | ⬜ not yet | First design note is due with the booking surface (Sprint 3) |
| 015 | Pricing in €/room/month equivalence | ⬜ not yet | Sprint 8 reporting |
| 016 | Property is a URL segment | 🟨 partial | `properties.slug` with the reserved-word and format constraints exists; routes still flat |
| 017 | Identity tables sit outside tenancy | ✅ as-built | `profiles` isolated by `auth.uid()`; asserted separately in the suite |
| 018 | RLS enforced on the Drizzle path via `withUser` | ✅ as-built | `packages/core/src/db/session.ts`; removing the role-drop fails 8 of 21 |

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
