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
pnpm db:seed       # the isolation fixtures truncate; put the dev data back
```

That last line is not optional housekeeping. The fixtures delete every row in
the public schema — they have to, because a suite that runs against leftover
data proves whatever the leftovers happen to allow. Running `test:rls` against
your local stack therefore empties it, and the next thing you do will fail in a
way that looks like the code broke.

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
| `reconciliation_runs` | member | — ¹⁰ | — ¹⁰ | — ¹¹ | 2026-08-28 |
| `discrepancies` | member | — ¹² | member ¹³ | — ¹¹ | 2026-08-28 |
| `notifications` | member | — ¹⁴ | — ¹⁴ | — ¹⁵ | 2026-08-28 |
| `payments` | member | — ¹⁶ | — ¹⁶ | — ¹⁷ | 2026-08-28 |
| `fee_events` | member | — ¹⁸ | — ¹⁸ | — ¹⁸ | 2026-08-28 |
| `journey_states` | member | — ¹⁹ | — ¹⁹ | — ¹⁹ | 2026-08-28 |
| `registration_records` | member | — ²⁰ | — ²⁰ | — ²¹ | 2026-08-28 |
| `alloggiati_submissions` | member | — ²² | — ²² | — ²³ | 2026-08-29 |
| `kb_articles` | member | member | member | — ²⁴ | 2026-08-29 |
| `message_threads` | member | — ²⁵ | member ²⁶ | — ²⁷ | 2026-08-29 |
| `messages` | member | member ²⁸ | — ²⁹ | — ²⁹ | 2026-08-29 |
| `stay_tasks` | member | member | member | — ³⁰ | 2026-08-29 |
| `stay_extras` | member | — ³¹ | — ³¹ | — ³¹ | 2026-08-29 |
| `invoice_requests` | member | — ³² | — ³² | — ³² | 2026-08-29 |
| `attribution_events` | member | — ³³ | — ³³ | — ³³ | 2026-08-29 |
| `subscriptions` | member | — ³⁴ | — ³⁴ | — ³⁴ | 2026-08-29 |
| `monthly_reports` | member | — ³⁵ | — ³⁵ | — ³⁵ | 2026-08-29 |
| `fee_disputes` | member | member ³⁶ | — ³⁷ | — ³⁷ | 2026-08-29 |

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
10. Written by the nightly job under the service role. A run recorded by a
    person would be a fabricated parity measurement, and these rows are the
    evidence D11's condition C2 asks for.
11. A discrepancy explained away and then deleted leaves a parity ratio nobody
    can reproduce — and that ratio is the number the fiscal-core gate turns on.
12. A discrepancy is an observation that two systems disagree. A person cannot
    observe that into existence.
13. Resolving one writes `status`, `explanation`, `resolved_by` and
    `resolved_at` — the one-tap action the exceptions inbox offers (PRD C1).
14. Queued in the same transaction as the thing being announced, then moved by
    the sender. A person inserting a row would assert that a message was queued
    when none was; a person editing one would hand-write a delivery record,
    which is worse than no record because it looks like evidence.
15. The row is the audit trail for a message that already reached a human
    being. Retention is the E8 job's decision, applied on a schedule, not a
    button next to a row.
16. The payment provider's webhook is the only state authority (03 §7.2). A row
    written from a session would assert that money moved when nothing did, and
    a refund is a new movement rather than an edit of the charge it reverses —
    which is why there is no update path even for the status column.
17. Deleting one erases the record of a real charge to a real person.
18. Computed once, at confirmation, from the values true at that moment. The
    monthly report built on these rows **is the invoice** (D14), so a
    hand-written or hand-edited fee is a line nobody can reproduce. Staff read
    it as well as owners: these rows are the evidence behind a number the owner
    will be asked about, and a receptionist who can see the booking but not its
    fee cannot answer the question either.
19. Binding rule 4: journey state changes only via evented commands (ADR-013).
    A staff member who could update this table directly could mark a stay
    arrived without the transition that fires Alloggiati, sends the welcome
    message and records who did it — and G1 is computed from those events, so a
    state reached without one never happened as far as the product can tell.
    The console's arrival button therefore takes the same command every other
    trigger source does.
20. Written by the guest through the pre-arrival surface, which holds no session
    at all (ADR-007) and runs under the service role scoped to one reservation
    by a signed token. A staff member typing a companion's document number into
    our database happens at a desk with paper, not through this table.
21. Deletion here is a *feature* (E2.4) — and it deletes the **document**, not
    the row: the retention job nulls `document_path`, stamps `deleted_at` and
    emits an event. Deleting the row would destroy the audit trail proving the
    deletion happened.
22. Written by the staging and submission paths, which validate the party
    first. A hand-written row would assert a filing that does not exist, and a
    hand-edited acknowledgement is worse than none because it looks like proof.
    The property is the declarant — this row is what they would produce to show
    they complied.
23. After the identity documents are destroyed under E2.4, this row is the only
    remaining evidence that the filing happened. Deleting it would leave a
    property that met its obligation unable to show it.
24. An article the concierge has already quoted is evidence of what a guest was
    told. `published = false` takes it out of service without erasing what it
    said. Insert and update are open to staff as well as owners, unlike
    `room_types`: correcting a wrong wifi password is operating the property,
    not administering it, and an owner who needs a support ticket to fix it will
    let the concierge keep saying the wrong thing.
25. A thread is opened by the guest writing, inside the transaction that stores
    their first message. A staff-created empty thread would be a conversation
    the guest has never seen, sitting in the queue, waiting for a reply to
    nothing.
26. Taking a thread over, handing it back and closing it are session writes
    rather than worker calls, because the person deciding is looking at the
    thread when they decide. That is the whole of E3.3's one-tap takeover.
27. Deleting a thread destroys what a guest was told, which is exactly the
    record that matters when they say they were told something else.
28. The only insert policy in the schema that constrains a column other than
    `property_id`: `author = 'staff'` and `author_user_id = auth.uid()`. A
    session may write a message only *as itself*. Without it a person could
    insert a row labelled `agent`, which the tool-boundary audit reads as the
    software's output and an owner reads as something the product said. Both
    write paths meet in this table, so this is the only place it stays true.
29. No update and no delete, with no exception for typos. A message the guest
    has read is a record of what they were told; a correction is a new message,
    which is also how it works when somebody says the wrong thing at a desk.
30. Cancelling a task records that somebody decided not to do it, which is
    information. Deleting the row makes it look as though nobody ever asked.
31. An extra typed straight into the table is an amount a guest will be asked to
    pay that no command produced and no event records. Adding one is a domain
    command in the worker; when the console gains a "charge this to the room"
    button, that button calls the command rather than this table gaining a
    policy.
32. This row is a *request a guest made*, not a document anyone issued — we
    assign no number, generate nothing, and transmit nothing to any authority
    (D11, binding rule 6). No update, because editing what a guest asked for and
    then routing it as though they had asked for that is the failure this
    forecloses. `routed_at` is stamped by the worker when the request reaches
    the property.
33. These rows decide whether a booking is billed at 2–4% or at 8–12% (D14). A
    row writable from a session would let somebody manufacture "an engine
    session preceded this" to move a fee down, or delete one to move it up —
    either way the invoice would rest on a table a party to it could edit.
    Written by the booking surface and the concierge under the service role.
34. What a property pays for the platform is agreed in a contract, not set in
    the product. `rooms` lives here too, because it is the divisor in the
    €/room/month equivalence (ADR-015) — the line an owner compares against a
    competitor's price, and not a number the billed party should be able to
    move in either direction.
35. A draft is recomputed by the generator and an issued report is frozen. The
    whole value of the snapshot is that it does not change; an update policy
    would make "frozen" a convention rather than a property of the system.
    Nothing here is fiscal (D11): it computes no tax, issues no document, and is
    transmitted to no authority.
36. The only billing row a member writes, and the only insert policy in that
    migration. D14 resolves disputes in the owner's favour, and an owner who
    must open a support ticket to disagree is one whose disagreement is
    rate-limited by our availability. `raised_by` is pinned to `auth.uid()` for
    the same reason `messages.author_user_id` is: a dispute attributed to
    somebody else is a forged record of who objected.
37. The credit is applied when the dispute is raised, so there is no
    adjudication step to edit. Withdrawing one is a conversation, not a button
    that erases the evidence it happened.

## Exceptions — not property-scoped, and why

| Table | Why it carries no `property_id` | Still isolated by | ADR |
|---|---|---|---|
| `profiles` | Describes a *person*, not a property's business. One row per human; duplicating name/locale/theme per membership turns one fact into N that must agree | `user_id = auth.uid()` — a person reads and writes their own row and no other | [ADR-017](../adr/ADR-017-identity-tables-outside-tenancy.md) |

This is a different assertion from every property-scoped policy and does not
follow from any of them, so the suite tests it separately.

## Guest-surface access

Guests never hold a database session (ADR-007). There is no guest role in the
database, so no guest policy appears on this map. The boundary for each guest
surface is server-side code, and it is tested as such.

| Surface | Boundary | Reads | Writes |
|---|---|---|---|
| `/[locale]/book/[property]` | the slug in the URL, resolved to one property id server-side | that property's `room_types` and `rate_snapshots` | one `guests`, one `reservations`, one `notifications`, one `payments`, one `fee_events`, all carrying that id |
| `/[locale]/book/[property]/manage/[reservation]` | the reservation UUID, unguessable and scoped to one booking | that reservation and its refund quote | its cancellation and refund |
| `/webhooks/payments` (worker) | the provider's payload **signature** — not a bearer token, because a provider cannot hold one | the payment and its reservation | confirms the booking, settles the payment, writes the fee |
| `/[locale]/stay/[token]` | an HMAC-signed token carrying one reservation id and its own expiry, verified server-side | that reservation, its journey, its party, its thread and what it has paid | its `registration_records`, its journey transitions, one private Storage object per guest, its own `messages` and `message_threads` row, its `stay_tasks`, and one `invoice_requests` |

The stay token is stateless: no table, no revocation list. What makes that safe
is that the resolver **re-reads the reservation on every request**, so a
cancelled booking stops working the moment it is cancelled. Rotating
`STAY_TOKEN_SECRET` invalidates every outstanding link at once, which is the
blunt instrument if one is ever leaked in bulk. Per-token revocation would need
a table, and that is a decision to write down at the time rather than now.

Identity documents live in the private `identity-documents` bucket with **no**
storage policy for the `authenticated` role. Nothing reaches them from a
browser: the guest uploads through a server action and the console reads through
a signed URL valid for two minutes, both minted server-side under the service
role.

The booking surface runs under `asService`, because an anonymous visitor has no
JWT for a policy to read. That makes the explicit `property_id` on every query
the whole of the isolation, not a convenience — which is the case ADR-007
anticipates and binding rule 3's second sentence exists for. The suite asserts
it by asking the surface for another property's room types by id and expecting
nothing back.

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
