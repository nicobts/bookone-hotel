---
name: add-table
description: Use when adding or changing a database table. Enforces property scoping, RLS policies in the same migration, the policy map, and migration testing — the sequence where a missed step leaks one hotel's data to another.
---

# Add or change a database table

Every step exists because skipping it has a specific, expensive consequence.
This is the highest-risk routine work in the repository.

## Before writing anything

Read `docs/03-ARCHITECTURE.md §2` for the intended shape and `CLAUDE.md` for the
binding rules. Check `docs/adr/` for a decision that already covers it.

## The sequence

**1. Define the table in `packages/core/src/db`.**

Non-negotiable:

- **`property_id` on every domain table**, denormalized even where a join could
  derive it (binding rule 3)
- **Platform UUID primary key.** An external system's identifier is never a key
  — it attaches through `external_refs` (ADR-001, binding rule 1). This one is
  CI-enforced; write it right the first time
- **Money as integer cents with an explicit currency**, never a float
- **Nothing fiscal.** No SDI, corrispettivi, night-audit or invoice-issuance
  column, under any framing or column name (ADR-002 / D11)

**2. Emit the event.** Every mutation on this table writes a `domain_events` row
with actor and origin (`platform | sync | reconciliation`) — binding rule 2. If
the table is written by a path that cannot emit, that path is the bug.

**3. Generate the migration.**

```bash
pnpm db:generate
```

**4. Read the generated SQL. Every time.**

It expresses what the tool _inferred_. A renamed column can generate as a drop
plus an add — a rename in development, data loss in production. This step is
what catches it.

**5. Add RLS to the same migration file.**

Not a follow-up commit. That commit does not reliably happen, and a table
shipped without policies is a table that leaks. Migrations are forward-only and
the policy SQL ships with the schema change it protects (binding rule 9).

**6. Update `docs/runbooks/rls-policies-map.md`.**

A policy not on the map is a policy nobody audits. If the table is deliberately
_not_ property-scoped — an identity table, say — record it in the exceptions
table **with its justification**, and write the ADR that permits it.

**7. Test it, on both access paths.**

```bash
pnpm db:reset      # replay from zero — proves it works on a clean database
pnpm typecheck
pnpm test:rls
```

Then verify isolation, which **cannot be done by reading the policy**. As a
member of property A, query for a row belonging to B:

- **zero rows** — correct
- **an error** — the policy was never exercised; your query is wrong
- **a filtered subset** — partially applied, worse than absent, because it looks
  correct

Do this on **both** paths. The application connects with a role that may hold
`BYPASSRLS`, in which case every policy is invisible to it and a plain select
returns every property's rows — silently, with no error and no failing test. The
client-path suite passing tells you nothing about this one.

**8. Record the verification date** in the policy map.

## Do not

- Apply schema changes through a dashboard — untracked, unreviewable,
  irreproducible
- Edit a migration already applied anywhere but your own machine — append-only,
  fix forward
- Drop and recreate in one migration — that is two migrations, with a deploy
  between them
- Add a `where property_id = …` in application code and call it isolation. It is
  scoping. Isolation is the policy, and the difference is tabulated in ADR-016
