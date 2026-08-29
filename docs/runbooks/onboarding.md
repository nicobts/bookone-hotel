# Runbook — onboarding a property

**Target: five days, no engineering.** That is the GA gate (04 §1 Sprint 9),
and it is a business constraint rather than an aspiration — G5, support
economics, is the moat that fails first if this takes a week of somebody's
attention.

Everything below is configuration. If you find yourself needing a code change to
onboard a hotel, that is the finding, and it belongs in an issue rather than in
a workaround.

---

## Before you start

You need three things from the property, and only three:

1. **Their name, languages and timezone.** Which languages they actually
   operate in, not which they would like to. A language on this list with no
   knowledge-base answers is a language the concierge escalates every question
   in.
2. **Their room types**, with a code and a capacity each.
3. **An email address that a person reads.** Booking requests, waiting-guest
   alerts and invoice requests all go there, and each fails silently and
   separately without it.

Anything else — colours, deposit policy, tourist tax, knowledge base — improves
the result and blocks nothing. Say so when you ask for it, or you will wait a
week for a hex code.

## Day one: make it exist

```sql
insert into properties (slug, name, locale_default, languages, timezone, settings)
values (
  'garni-example', 'Garni Example', 'it', '["it","de","en"]'::jsonb, 'Europe/Rome',
  '{"contact": {"email": "info@example.test"}}'::jsonb
);
```

Then room types, then the owner's membership:

```sql
insert into property_members (property_id, user_id, role)
values ('<property-uuid>', '<auth-user-uuid>', 'owner');
```

There is no self-serve signup and there should not be one yet: every property in
V1 arrives through a conversation, and a sign-up form would be a support surface
for people we have not spoken to.

Open `/{locale}/{slug}/console/setup`. The checklist reads the rows you just
wrote — it is derived, not stored, so it is telling you the truth about the
database rather than about a form somebody filled in.

## Day one, still: the plan and the modules

```ts
await setSubscription({
  propertyId: '<uuid>',
  plan: 'standard',
  baseCents: 25_000,
  rooms: 18,           // the divisor in the €/room/month line (ADR-015)
})

await grantEntitlement({ propertyId: '<uuid>', feature: 'concierge' })
```

`rooms` is the number of **rooms**, not room types. Leave it out rather than
estimating: the per-room line then does not appear, which is better than a wrong
number on the one figure an owner compares against a competitor's price.

## Day two: the knowledge base

This is the part that decides whether the concierge is useful, and the part
nobody does. Two ways in, and use both:

**Scrape their site first.** It produces drafts, and reviewing six drafts is a
task an owner will do; writing six articles from nothing is not.

```
pnpm tsx scripts/enqueue.mts   # (see the job below)
```

or enqueue `onboarding.ingest` with `{ propertyId, url, locale }`. The `locale`
is the language *the page is written in* — it is never sniffed, because guessing
wrong files an Italian answer under `de` and the concierge then reads it to a
German guest as the property's own words.

Everything it writes is a **draft**. `searchKb` refuses to quote an unpublished
article, so nothing reaches a guest until the owner presses publish.

The URL must be a **public** address. Anything resolving to loopback, a private
range, link-local or a cloud metadata endpoint is refused, because the response
would be stored and shown back in the console — which would make this a way to
read our own internal services. That includes `localhost`, so a page served on
your own machine cannot be used to demo it; put the fixture somewhere public or
test the extraction with the unit suite.

**Then sit with the owner for twenty minutes** in `/console/knowledge`. The
questions worth having answers to, roughly in order of how often they arrive:
breakfast, wifi, parking, check-in and check-out times, pets, and how to get in
after hours.

Watch the **Missing: XX** badges. Every one is a language in which that question
will be handed to a person. Filling them is the single highest-leverage thing
anybody does during onboarding.

**Never** paste a machine translation into a language box. The whole design
rests on the property having stood behind every sentence (binding rule 7).

## Day three: watch it work

Book a stay on the property's own booking page, follow the pre-arrival link, and
ask the concierge something you know is in the knowledge base and something you
know is not. You should see one answer and one escalation, and the escalation
should appear in `/console/conversations` as nobody's.

If prices are missing, the booking page shows a request form. That is correct
behaviour and it means the availability refresh has not run — check the worker,
not the configuration.

## What you cannot finish, and must say so

Two checklist items are marked *we do these*, and one of them is genuinely
blocked:

- **Payment account.** No provider is connected (ADR-010, 04 §0 item 6). Say
  this out loud during onboarding. An owner who discovers at go-live that
  payments were never configured has been misled by an absence, and the item is
  on the checklist rather than hidden for exactly that reason.
- **Alloggiati.** The channel decision is open (04 §0 item 5) and the record
  layout is unverified — see `alloggiati.md`. Nothing is filed with any
  authority.

## The staff account

Add a receptionist as `role = 'staff'`. They see Today, Exceptions,
Conversations, Reservations and Guests, and nothing else — every configure route
404s for them, server-side, and so does every action behind it.

That is E5.5's "productive on day one": five things they can act on rather than
nine, four of which would refuse them.

## When it takes longer than five days

The failure is almost never the software. In order of likelihood:

1. **Waiting for content.** Colours, photographs, policy wording. Ship without
   them — none of it blocks a booking, and the checklist says so.
2. **Waiting for a decision the owner has not made.** Deposit percentage,
   cancellation windows. Ship with no deposit; it is a legitimate configuration
   and changing it later is one screen.
3. **Prices not flowing.** A real problem, and an engineering one. It is the
   only blocking item on the checklist that an owner cannot fix themselves.

Record which one it was. The DoD is a non-engineer doing this in ≤5 days, and
the thing that makes that true next time is knowing what took the time this
time.
