# ADR-017 — Identity tables sit outside tenancy

**Status:** Accepted · **Date:** 2026-08-28
**Depends on:** ADR-007 (RLS is the tenant-isolation mechanism), ADR-016 (the active property is a URL segment)

## Triggering event

Schema v1 needs somewhere to keep a person: display name, locale, theme, and
which property they land in after login. Sprint 1 commits to "Auth (owner/staff
roles); console shell", and none of it can be built without that row.

Binding rule 3 requires `property_id` on every client-reachable table, with RLS
keyed to it. A person is not a property's business record, and 03-ARCHITECTURE
§2 has no identity table at all — the sketch begins at `properties` and never
describes who signs in. This record is the permission the project's own rules
require before adding tables that do not carry `property_id`.

## Context

Supabase Auth owns `auth.users`: credentials, email, confirmation state. What it
does not own is anything the product needs to *show* — a name in the user menu,
a preferred locale out of the four, a theme, a default property for the
post-login redirect.

Two tables are needed and they are different in kind:

- **`profiles`** — one row per person. Describes a human being.
- **`property_members`** — one row per (person, property) pair, with a role.
  Describes a *relationship* between a person and a hotel.

The second is not the problematic one: it carries `property_id` naturally and
takes an ordinary policy. The question is only about the first.

## Decision

**Identity tables are exempt from the `property_id` rule.** `profiles` carries
no `property_id` and is isolated by user identity instead: a person may read and
write exactly their own row, enforced by RLS against `auth.uid()`.

The rule continues to bind every table describing a property's business —
guests, reservations, room types, rate snapshots, events, agent runs, and
everything that follows them. `profiles` is the first table of a different kind,
and today it is the only one.

**`property_members` is not an exception.** It carries `property_id`, it is
property-scoped, and it is the table every other policy resolves membership
through.

## Cost of change / cost of not changing

**If wrong:** collapsing `profiles` under tenancy means splitting one row per
person into one row per (person, property) pair, deciding which columns may
diverge, and writing reconciliation for the ones that must not. A real
migration, but bounded — this is the only table in this shape.

**If not done:** the alternative is a property-scoped profile row per
membership. An owner with three garni gets three rows holding the same name,
locale and theme, with nothing in the schema keeping them equal. The first
symptom is not a crash: it is a person renaming themselves at one hotel and
staying stale at the other two. Worse, the genuinely global columns — `locale`,
`theme` — would have to be kept in sync by application code across rows that RLS
deliberately keeps apart, which is precisely the failure mode the rule exists to
prevent, reproduced one level up.

## Alternatives rejected

- **One `profiles` row per membership**, matching the rule literally. Rejected
  above: it turns one fact about a person into N facts that must agree.
- **Keep it all in `auth.users.raw_user_meta_data`.** No constraints, no foreign
  keys, no typed access from Drizzle, and it is writable by the client on some
  paths. A default property held there could name a property the person was
  removed from months ago.
- **No profile table; derive everything from the first membership.** Works until
  a person has two, at which point locale depends on which hotel you ask from.

## Consequences

- The policy map (`docs/runbooks/rls-policies-map.md`) gains an **exceptions**
  section, and `profiles` is its first entry with this ADR as justification. An
  exception without a written reason is how the next one gets waved through.
- The cross-tenant suite must cover this shape too: person A must not read
  person B's profile. That is a different assertion from the property-scoped
  ones and does not fall out of them.
- `profiles.default_property_id` is a *preference*, never a permission.
  Resolving it must re-check membership, or an owner removed from the property
  they had chosen gets redirected into a 404 on every login with nothing on
  screen explaining why.
- Deleting a person is now two concerns — the auth row and the profile — which
  matters for the GDPR erasure endpoint (E8). Recorded here so it is found when
  that is built, not after.
