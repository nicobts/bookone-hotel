# ADR-018 — RLS is enforced on the Drizzle path via withUser

**Status:** Accepted (as-built) · **Date:** 2026-08-28
**Depends on:** ADR-006 (Supabase, Drizzle for domain access), ADR-007 (RLS is the tenant-isolation mechanism)

## Triggering event

Immediately before writing the first data-access code, a check of how Drizzle
actually connects to the local database produced this:

```
role in DATABASE_URL:  postgres   rolsuper = f   rolbypassrls = t
authenticated                     rolsuper = f   rolbypassrls = f
```

`DATABASE_URL` connects as `postgres`, which holds `BYPASSRLS`. **Every policy
in the database is invisible on that connection.** A plain
`db.select().from(reservations)` returns every property's rows — no error, no
warning, and no failing test.

This contradicts what ADR-007 states: *tenant isolation is enforced by the
database, not by application code.* That was true of the path the client-side
isolation tests exercise (PostgREST with a user JWT) and false of the path the
application was about to use. Two access paths, one of them silently open.

Caught before any feature depended on it. Had the console's arrivals list been
written first, every query would have been cross-property and a passing test
suite would have said otherwise.

## Decision

Application code never touches the raw client for user-facing work. All reads
and writes on behalf of a signed-in user go through **`withUser(userId, fn)`**
in `packages/core/src/db/session.ts`, which opens a transaction that:

1. sets `request.jwt.claims` to the user's id — this is what `auth.uid()` reads,
   and therefore what every policy resolves against;
2. drops to the `authenticated` role, giving up `BYPASSRLS`.

Both use `set local`, so they are transaction-scoped. On a pooled connection a
session-scoped setting would leak one user's identity into the next request —
that is the specific failure this shape prevents.

`asService(fn)` is the deliberate, conspicuous exception for work that genuinely
spans properties: the sync engine, nightly reconciliation, invitations, seeds.
Binding rule 3 still binds inside it — service-role is not permission to write
an unscoped query.

## Cost of change / cost of not changing

**Cost now:** one helper, one extra transaction per request, and a rule everyone
must follow. The transaction is not free, but it is a local round trip on a
connection already open.

**Cost of not changing:** a data model whose central promise is false on its main
path, with a passing test suite asserting otherwise. The likely discovery route
is a hotel seeing another hotel's guest list — which in this product is also a
personal-data breach, reportable under GDPR, in a segment sold on trust (M6).

**Cost of reversing:** low. `withUser` is a wrapper; the policies underneath are
unchanged and keep protecting the client path regardless.

## Alternatives rejected

- **Query through PostgREST with the user's session.** RLS would apply, but it
  abandons typed queries and migrations, and puts the application on the same
  interface as untrusted clients.
- **Filter by `property_id` in every query.** Precisely what ADR-007 exists to
  forbid: isolation becomes a property of whoever wrote the last `where` clause,
  and one omission is a breach with no error.
- **A dedicated non-superuser database role.** Equivalent in effect, but it still
  needs the JWT claim installed per request, so it adds an operational moving
  part without removing the interesting one.

## Consequences

- **Two isolation suites now exist, one per access path**, and neither
  substitutes for the other: `client.test.ts` (PostgREST with a real user JWT)
  and `session.test.ts` (Drizzle through `withUser`). Both run as the `test:rls`
  gate.
- `session.test.ts` opens by **asserting that the raw client does leak** — an
  odd-looking test that exists so that deleting `withUser`, or quietly swapping
  a call for a bare `db.select()`, fails loudly instead of failing open.
- **Verified by negative control, not by reading:** removing the role-drop from
  `withUser` fails 8 of 21 tests; restoring it returns 21 of 21. A suite that has
  never been seen to fail is not evidence.
- A `where property_id = …` in application code is now a smell, not a safeguard.
  If `withUser` returns nothing, the bug is the membership.
- ADR-007 stands, with its scope corrected: the database enforces isolation on
  *both* paths, but only because the application asks it to on this one.
- Guest surfaces are unaffected and deliberately absent from this record. Guests
  never hold a database session (ADR-007); `/[locale]/stay/[token]` resolves a
  signed token server-side and queries on their behalf, scoped to one
  reservation. That resolver is its own boundary and gets its own tests when it
  lands in Sprint 5.
