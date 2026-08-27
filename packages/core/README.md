# @bookone/core

**All domain logic lives here.** `apps/web` and `apps/worker` both import this
package; neither reimplements any part of it (docs/03-ARCHITECTURE.md §10,
ADR-003).

## Contents

| Path            | Owns                                                                     | Filled by      |
| --------------- | ------------------------------------------------------------------------ | -------------- |
| `src/db`        | Drizzle schema v1, migrations, RLS policy SQL, cross-tenant test harness | day-1 task 2   |
| `src/types`     | Canonical domain types derived from the schema                           | day-1 task 2–3 |
| `src/events`    | `domain_events` emitter — every mutation goes through it                 | day-1 task 3   |
| `src/authority` | `AuthorityMap` + write-router (per domain, per property)                 | day-1 task 3   |
| `src/llm`       | `LlmProvider` interface and registry (ADR-012)                           | day-1 task 3   |
| `src/adapters`  | `PmsAdapter` / `PaymentAdapter` / `JobQueue` interfaces                  | day-1 task 4   |
| `src/journey`   | Guest-journey state machine (ADR-013)                                    | Sprint 2+      |
| `src/policy`    | Deposit / cancellation policy engine                                     | Sprint 4       |

## Standing constraints

- **Platform UUIDs are the only keys.** External system identifiers attach
  through `external_refs` and are never used as primary or foreign keys
  (ADR-001, binding rule 1).
- **Every mutation emits a `domain_events` row** carrying actor and origin
  (`platform | sync | reconciliation`) — binding rule 2.
- **Journey state changes only via evented commands** on the state machine. No
  module writes `journey_states` directly (ADR-013, binding rule 4).
- **Type flow is one-way:** Drizzle schema → core types → Hono RPC → web. No
  hand-written duplicate types anywhere downstream (binding rule 10).
- **No Supabase-proprietary constructs in the domain layer** — the exit path is
  plain Postgres (ADR-006).
- **No fiscal-core code** (SDI, corrispettivi, night audit, invoice issuance)
  under any framing — gated by D11 / ADR-002.
