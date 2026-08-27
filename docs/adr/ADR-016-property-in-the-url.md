# ADR-016 — The active property is a URL segment

**Status:** Accepted · **Date:** 2026-08-27
**Depends on:** ADR-006 (Supabase Auth), ADR-007 (RLS is the tenant-isolation mechanism)
**Amends:** 03-ARCHITECTURE §1, which listed the console as a flat `/console`

## Triggering event

Sprint 1 commits to "Auth (owner/staff roles); console shell with Today
placeholder". Building the shell requires answering a question the doc set left
open: **which property am I looking at right now** — distinct from **which
properties may I see at all**.

The second question was already answered: RLS decides it, in the database
(ADR-007). This record is only about the first.

## Context

Most owners operate one property, so the question looks academic. It is not:

- Small groups exist in the target segment. Two or three garni under one owner
  in the same valley is an ordinary shape in IT/AT/SI, and D16 does not exclude
  them — it excludes B&Bs and vacation rentals.
- Staff are not owners. A seasonal receptionist may cover two houses.
- Our own support work is multi-property by nature.

Three shapes were considered.

**Cookie-scoped.** Routes stay `/[locale]/console/…`; a switcher writes a
cookie; every page reads it. Cheapest — matches 03 §1 as written, no slug
column, no route changes.

**URL-scoped.** Routes become `/[locale]/[property]/console/…`. Costs a `slug`
column, a reserved-word constraint, and every console route moving one segment
deeper.

**No scope at all.** One merged view across every property the user can see,
with a property column and a filter. Rejected immediately: the console is an
exception-handling surface (D15), and an exceptions inbox that mixes two hotels'
arrivals is not an inbox.

## Decision

**The property is a segment in the path**, immediately after the locale:
`/[locale]/[property]/console/…`. It is identified by a slug, unique across the
table, enforced by a check constraint and a reserved-word list.

The two guest surfaces are unaffected and keep the shapes 03 §1 specifies:
`/[locale]/book/[property]` is public and already names its property, and
`/[locale]/stay/[token]` resolves the reservation — and therefore the property —
from the token, server-side.

## Cost of change / cost of not changing

**If wrong:** expensive, which is why this is a record. Moving to a cookie later
means every link anyone saved stops resolving.

**If not done:** a URL stops identifying what is on screen. `/it/console/today`
shows different arrivals depending on what the reader last clicked, so a link
pasted into a support thread is a gamble and a screenshot-plus-URL bug report
does not say which hotel it is about. For a product whose support economics are
the business model (G5, ≤2 contacts/property/month), that is a direct cost.

## Alternatives rejected

- **Cookie-scoped** — one cookie is shared by every tab, so an owner cannot hold
  two properties open side by side. That is the first thing a two-property owner
  tries.
- **Property in a React context or `localStorage`** — same defect as the cookie,
  plus hidden state that must be invalidated when membership changes.
- **No scope** — see Context.

## Consequences

### What this buys

**A URL means one thing.** Shareable, bookmarkable, and the back button works
with no effort.

**Two properties, two tabs.** The concrete thing a group owner would hit first.

**No hidden state to get out of sync.** There is no "current property" held
anywhere. The URL is the state, the server reads it per request, and there is
nothing to invalidate when a membership changes.

### What it costs

**Slugs are globally unique**, even between properties no single person can see.
A URL has no owner, so this is inherent to the choice.

**Slugs are effectively immutable.** Changing one breaks every saved link. There
is deliberately no UI to edit a slug; renaming a hotel leaves its slug alone.

**Route names become reserved words.** The framework resolves static segments
before dynamic ones, so a property slugged `book`, `stay`, `console`, `login` or
a locale code would insert cleanly and be permanently unreachable. A
`properties_slug_reserved` check constraint prevents it, and **it must be
extended whenever a route is added under `/[locale]/`**. That maintenance burden
is real and is accepted knowingly: the alternative failure is silent.

**Route protection inverts.** A list of protected path prefixes cannot work once
application paths begin with arbitrary text. It becomes a list of *public*
paths, with everything else requiring a session — which is also the safer
direction. A forgotten entry in a public allowlist makes a public page ask for a
login, which gets reported within the hour. A forgotten entry in a protected
list leaves a page open, and nobody reports it.

This inversion needs care that a single-surface product does not: BookOne has
two guest surfaces that must stay reachable without a session, so the check is
three-way — public, token-scoped, session-scoped — not two-way.

### What it does not change

**Nothing about isolation.** The slug is a lookup key, not a permission. A user
typing another hotel's slug gets a 404 because RLS returns no row, not because a
route check rejected them. `notFound()` and not a redirect: a slug is guessable,
and 404 is the only response that does not confirm whether the property exists.

| | Scoping | Isolation |
|---|---|---|
| Answers | which property am I looking at | which properties may I see |
| Lives in | the URL, and a `where` clause | RLS policies |
| If wrong | user sees too little of *their own* data | user sees *another hotel's* data |
| Enforced by | application code | the database |

A `where property_id = …` in a list query is the first row, never the second. It
is safe to add for that purpose and must never be relied on for the other —
which is exactly what binding rule 3 means by "service-role queries still scope
explicitly".

## Notes

Login, password reset and email confirmation all need a destination, and two of
them run in the browser where the user's memberships are unknown. A
`/[locale]/console` route survives as a **redirect** rather than a page: it
resolves the user's first property server-side and forwards. A user with no
membership gets a page saying so, not a redirect loop or an empty console
implying data loss.

The pattern, the reserved-word failure mode and the allowlist inversion are
taken from a sibling codebase that shipped this shape and hit each of them.
