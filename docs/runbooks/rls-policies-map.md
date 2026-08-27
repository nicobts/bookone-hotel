# RLS policy map

Every client-reachable table, its policy, and when isolation was last **verified
by query** rather than by reading the policy.

A policy not on this map is a policy nobody audits. Binding rule 3 makes RLS a
merge gate; this file is how we know the gate covers everything.

## How to use it

- A new table adds a row here **in the same PR** as its migration. See
  `.claude/skills/add-table/SKILL.md`.
- A table deliberately *not* property-scoped is recorded in the exceptions
  table **with its justification**. "This one doesn't need a policy" is the
  sentence that precedes a leak.
- The verification date is set by running the isolation check, not by reviewing
  the SQL. A policy that was never exercised looks identical to one that works.

## Verifying isolation

Reading a policy proves nothing. As a member of property A, query for a row
belonging to property B:

- **zero rows** — correct
- **an error** — the policy was never exercised; the query is wrong, not the policy
- **a filtered subset** — partially applied, which is worse than absent, because
  it looks correct

Both access paths need this, separately (see
`docs/adr/IMPLEMENTATION-STATUS.md`): the JWT-bearing client path and the
application's own Drizzle path.

## Tenant-scoped tables

| Table | Policy | Scoped by | Last verified |
|---|---|---|---|
| _(schema v1 lands in day-1 task 2 — rows added with it)_ | | | |

## Exceptions — not property-scoped, and why

| Table | Why it carries no `property_id` | Still isolated by |
|---|---|---|
| _(identity tables land with schema v1; each needs its justification here and an ADR)_ | | |

## Guest-surface access

Guests never hold a database session (ADR-007). `/[locale]/stay/[token]` resolves
a short-lived signed token **server-side** and queries on the guest's behalf,
scoped to one reservation. There is no guest role in the database, so there is
no guest policy on this map — the boundary is the token resolver, and it is
tested as such.
