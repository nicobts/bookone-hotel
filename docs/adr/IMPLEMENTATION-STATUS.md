# Implementation status

A decision recorded is not a decision shipped. This table is the gap.

Update it in the same PR that changes the answer — a status file that lags is
worse than none, because it is read as current.

| ADR | Decision | Built? | Where |
|---|---|---|---|
| 001 | Platform UUIDs; external systems via `external_refs` | ⬜ not yet | `external_refs` lands with schema v1 (day-1 task 2) |
| 002 | Fiscal core gated | ✅ by construction | Nothing fiscal exists. Enforced by absence, not by a check |
| 003 | Two deployables; worker is persistent | ✅ as-built | `apps/web`, `apps/worker`; constraint stated in the worker README |
| 004 | Hono on `@hono/node-server` | ✅ as-built | `apps/worker/src/app.ts` |
| 005 | pg-boss behind a `JobQueue` interface | ⬜ not yet | Dependency installed; wiring is Sprint 2 |
| 006 | Supabase EU; Drizzle for domain access | ⬜ not yet | Day-1 task 2 |
| 007 | RLS on every client-reachable table, tested in CI | ⬜ not yet | Day-1 task 2. **Two access paths need two suites** — see the note below |
| 008 | Mock-first connector | ⬜ not yet | `packages/adapters` scaffolded; day-1 task 4 |
| 009 | Voice hard tool boundaries | ⬜ WS-B | Not this workstream |
| 010 | Stripe behind `PaymentAdapter` | ⬜ not yet | Sprint 4 |
| 011 | Agents as first-class workers, tiered autonomy | ⬜ not yet | `packages/agents` scaffolded; `agent_runs` is day-1 task 2, runner is Sprint 2 |
| 012 | `LlmProvider` abstraction; no vendor SDK imports | 🟨 partial | The prohibition is enforced now by `no-restricted-imports` in `eslint.config.mjs`; the interface itself is day-1 task 3 |
| 013 | Journey state machine is the single source of stay truth | ⬜ not yet | Sprint 2 |
| 014 | Reference implementations over blank-page design | ⬜ not yet | First design note is due with the booking surface (Sprint 3) |
| 015 | Pricing in €/room/month equivalence | ⬜ not yet | Sprint 8 reporting |
| 016 | Property is a URL segment | ⬜ not yet | Console shell, after schema v1 |

## The ADR-007 note

ADR-007 says the database enforces isolation. That is true of the path a client
takes (PostgREST with a user JWT) and **not automatically true of the path the
application takes** (Drizzle over `DATABASE_URL`), because that connection may
hold a role with `BYPASSRLS` — in which case every policy is invisible and a
plain `select` returns every property's rows, with no error and no failing test.

So "RLS is on" is two claims, and each needs its own suite:

- policies hold for a JWT-bearing client, and
- the application asks the database to apply them, per request, per user.

Neither substitutes for the other. Marking ADR-007 built requires both, and the
second one is the one that fails silently.
