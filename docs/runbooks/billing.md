# Runbook — attribution, the monthly report, and disputes

The report is **the invoice basis** (PRD C4). This is how it is produced, what
to do when an owner argues with it, and the two things about it that are not
what they look like.

## The rule, in one place

D14: *a booking is AI-attributed only if it originates in a concierge session
and no engine session preceded it within 24h. Disputes resolve in the owner's
favour.*

Implemented in `packages/core/src/billing/attribution.ts`. Two clarifications
the wording does not settle, both decided in the owner's direction:

**"Preceded it" means preceded the conversation, not the booking.** A guest who
opens the chat, gets sent a link and finishes on the booking engine is
attributed — the conversation produced the booking. Comparing against the
booking timestamp would call every such stay direct.

**"It" means this booking.** Only engine touches from the booking's own sessions
disqualify it — the concierge session, or an engine session recorded on the
reservation. A *different* guest browsing the engine an hour earlier is
irrelevant. The first implementation compared against every touch the property
saw, which meant a property taking a few bookings a day would never have an
attributed line at all.

The residual error runs in our favour: a guest who browses in one browser and
chats in another escapes the disqualification. That is what AG-07 and the
dispute button are for.

## Reading a fee

Everything needed to explain a charge is on the `fee_events` row:

```sql
select kind, basis_cents, rate_bps, fee_cents, evidence
from fee_events where reservation_id = '<uuid>';
```

`evidence` is stored at confirmation and never re-derived. That is deliberate:
an evidence chain rebuilt six months later runs against a database where the
guest has been anonymised (E8), the reservation may be cancelled and the session
has expired. Reconstruction is not evidence.

## When an owner disputes a line

**They do it themselves, from the line.** There is no queue and no ticket. The
button credits the fee immediately and the conversation happens afterwards —
that is D14 implemented literally, and `fee_disputes` has no `rejected` status to
reach.

If they raise it with you instead, the answer is to point them at the button. If
they cannot find it, that is a product problem worth fixing rather than a fee
worth adjusting by hand.

**A rising dispute rate is a signal about the rule, not about the owner.** If a
tenth of attributed bookings are being disputed, the attribution is wrong and
the fix is in `attribution.ts` — not in the dispute workflow.

**A dispute on an already-issued period is allowed.** The credit lands on the
*next* statement. Reopening an issued one would break the guarantee the whole
report rests on, and the owner already holds a copy of the first version.

## AG-07, and why an agent credits money

Runs nightly at 05:30 (`attribution.audit`). It re-runs the rule over every
AI-attributed fee in the last 40 days and credits any whose evidence no longer
holds.

It should find nothing. Fees are computed from the same rule at confirmation, so
a finding means the two paths have diverged — which is exactly what nobody would
otherwise notice until an owner did. **A credit is logged at `error` level and
should be treated as a bug report**, not as the system working.

The reason a T1 agent is allowed to do this: the only action it has reduces our
own revenue. There is no `raise_fee` tool and there will not be. An agent whose
entire capability is costing its operator money has a failure mode of a bad
quarter rather than a defrauded customer.

Run it by hand: `pnpm tsx scripts/enqueue.mts attribution`.

## Issuing a statement

`report.generate` runs at 06:00 on the **2nd**, not the 1st — a booking
confirmed at 23:50 on the last night of the month still has a fee, a reflection
and possibly a webhook in flight. It builds a **draft** and stops.

Issuing is the owner pressing *Accept this statement*. A job that froze it on
their behalf would make "accepted" mean something nobody did.

Once issued the snapshot is frozen and `buildReport` returns it verbatim. That
is checkable: add a booking to an issued period and re-read it — the total does
not move.

## Setting a property's plan

No UI yet (Sprint 9). Use `setSubscription`:

```ts
await setSubscription({
  propertyId: '<uuid>',
  plan: 'standard',
  baseCents: 25_000,
  rooms: 18,          // the divisor in the €/room/month line (ADR-015)
})
```

It **ends** the current row and inserts a new one. Never edit a subscription in
place: March's report has to be able to say what March cost after the price
changes in June.

`rooms` is null-safe. Leave it out rather than estimating — the per-room line
then simply does not appear, which is better than a wrong number on the one
figure an owner compares against a competitor's price.

## Two things that are not what they look like

**The "PDF" export is the browser's print of the page.** Not a shortcut: a PDF
library would be a second renderer of the same statement, the two can disagree,
and the one nobody looks at is the one that gets emailed.

**Nothing here is fiscal.** No tax is computed, no number is assigned, no
document is issued and nothing is transmitted to any authority (D11, binding
rule 6). The CSV says so on its first line, because it will be forwarded to a
commercialista. If a request arrives to make this "a proper invoice", it is an
ADR, not a ticket.
