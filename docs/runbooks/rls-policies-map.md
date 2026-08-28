# RLS policy map

Every client-reachable table, its policies, and when isolation was last
**verified by query** rather than by reading the policy.

A policy not on this map is a policy nobody audits. Binding rule 3 makes RLS a
merge gate; this file is how we know the gate covers everything.

## How to use it

- A new table adds a row here **in the same change** as its migration. See
  `.claude/skills/add-table/SKILL.md`.
- A table deliberately *not* property-scoped goes in the exceptions section
  **with its justification and its ADR**. "This one doesn't need a policy" is the
  sentence that precedes a leak.
- The verification date is set by running the isolation gate, not by reviewing
  the SQL. A policy that was never exercised looks identical to one that works.

## Verifying isolation

```bash
pnpm db:start      # local stack
pnpm db:reset      # replay every migration from zero
pnpm test:rls      # both access paths
```

Reading a policy proves nothing. As a member of property A, query for a row
belonging to property B:

- **zero rows** — correct
- **an error** — the policy was never exercised; the query is wrong, not the policy
- **a filtered subset** — partially applied, worse than absent, because it looks
  correct

**Both access paths, separately** (ADR-018). The client path is PostgREST with a
user JWT; the application path is Drizzle through `withUser`. The connection
behind the second holds `BYPASSRLS`, so the first suite passing says nothing
about it.

## Tenant-scoped tables

Policies are named `<table>_<command>`. Read is any member; administer is owners
only (`user_property_ids_admin()`).

| Table | select | insert | update | delete | Last verified |
|---|---|---|---|---|---|
| `properties` | member | any authenticated¹ | owner | — ² | 2026-08-28 |
| `property_members` | member | owner | owner | owner | 2026-08-28 |
| `guests` | member | member | member | — ³ | 2026-08-28 |
| `room_types` | member | owner | owner | owner | 2026-08-28 |
| `rate_snapshots` | member | — ⁴ | — ⁴ | — ⁴ | 2026-08-28 |
| `reservations` | member | member | member | — ⁵ | 2026-08-28 |
| `external_refs` | member | — ⁶ | — ⁶ | — ⁶ | 2026-08-28 |
| `domain_events` | member | member | — ⁷ | — ⁷ | 2026-08-28 |
| `agent_runs` | member | — ⁸ | member ⁹ | — | 2026-08-28 |

1. `with check (true)`. A new property has no members yet, so nothing else could
   pass; the `on_property_created` trigger makes the creator its owner in the
   same transaction, and the row is only reachable through that membership.
2. Properties are never deleted from a session. Reservations, events and agent
   runs cascade off them, and a hotel that leaves still has an audit trail
   someone may be required to produce.
3. GDPR erasure anonymises a guest; it does not drop the row. The reservation
   pointing at it has to survive (E8, PRD D6 retention).
4. Display cache written by the sync engine. Pruning is a worker job under
   `asService`, so no session-level write policy exists at all.
5. Cancelled by status, never removed. Money and attribution evidence hang off
   it, and the monthly report is the invoice (D14).
6. Written only by the sync engine. Members read it so the console can show what
   reflected and what has not.
7. Append-only. An event log that can be rewritten answers no question worth
   asking, and this one is the basis of G1, the agent audit trail and
   reconciliation.
8. An agent run recorded by a person would be a forged audit entry.
9. Accepting or rejecting a T2 proposal writes `outcome` and `reviewed_by` —
   the evidence a tier may widen (06 §4), so the reviewing human must be able to
   write it.

## Exceptions — not property-scoped, and why

| Table | Why it carries no `property_id` | Still isolated by | ADR |
|---|---|---|---|
| `profiles` | Describes a *person*, not a property's business. One row per human; duplicating name/locale/theme per membership turns one fact into N that must agree | `user_id = auth.uid()` — a person reads and writes their own row and no other | [ADR-017](../adr/ADR-017-identity-tables-outside-tenancy.md) |

This is a different assertion from every property-scoped policy and does not
follow from any of them, so the suite tests it separately.

## Guest-surface access

Guests never hold a database session (ADR-007). `/[locale]/stay/[token]` resolves
a short-lived signed token **server-side** and queries on the guest's behalf,
scoped to one reservation. There is no guest role in the database, so there is no
guest policy on this map — the boundary is the token resolver, and it is tested
as such. Lands in Sprint 5.

## Helper functions

| Function | Returns | Used by |
|---|---|---|
| `public.user_property_ids()` | properties the caller belongs to, any role | every read policy |
| `public.user_property_ids_admin()` | properties the caller owns | settings, membership, room types |

Both are `security definer` with `search_path` pinned empty and every reference
schema-qualified. The first is required — a policy on `property_members` that
queried `property_members` would recurse forever. The second is what makes the
first safe: without a pinned path, a caller could shadow the table and grant
themselves any property they liked.

There is deliberately **no** "may write domain rows" helper. V1 has two roles and
both operate the hotel — a seasonal receptionist confirms arrivals and answers
guests, which are writes (E5.5). A function whose name implied a distinction the
product does not have would be a function whose name lies. When a read-only role
appears, it gets its own helper and its own ADR.
