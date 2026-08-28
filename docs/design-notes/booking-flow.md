# Design note — booking flow (`/[locale]/book/[property]`)

**Surface:** guest booking engine, Sprint 3 (04 §1 Phase B).
**Stories:** E1.1, E1.2 (P0). E1.3 payment and E1.4 self-service change land in
Sprint 4 on the same four steps.
**Reference (08 §3, ADR-014):** Mews booking engine + Booking.com mobile flow.
**Adopted:** step count, form order, payment placement, reassurance copy
patterns.

---

## 1. Understand — what the references do, and why it works

Both references have converged, from opposite directions, on the same shape:
**search → choose → identify → confirm.** Mews arrives there as a hotel's own
engine; Booking.com as a marketplace optimising a funnel across hundreds of
thousands of properties. That two systems with different incentives agree on the
sequence is the strongest evidence available that the sequence is right, and it
is why the sequence is adopted rather than re-invented.

What the convergence actually encodes:

- **Dates and party size come first, alone.** Nothing else can be answered
  before them, and asking for anything else first produces a form the guest
  abandons before seeing a price.
- **One decision per screen.** The choice step shows rooms and prices and asks
  for exactly one thing: which room. Comparison is the whole job of that screen.
- **Identity is asked for last, and minimally.** Every field before payment is a
  field the guest can leave on. Marketplace funnels are ruthless about this
  because they can measure it.
- **The total is stated before commitment, itemised.** A price that changes
  between the choice screen and the confirm screen is the single most reliable
  way to lose a booking that was otherwise won.
- **Reassurance sits next to the commitment, not in a footer.** Cancellation
  terms, what is charged now versus at the property, and who the guest is
  actually booking with, all rendered at the point of hesitation.

Studied from publicly available booking engines as a guest would encounter them.
No trial account was created for dissection, no markup or copy was captured, and
nothing below reproduces expression — behavior and rationale only (ADR-014 §3.1).

## 2. Validate for our buyer

The references optimise for a different property than ours. Mews' engine is
attached to a PMS that owns its inventory outright; Booking.com's flow serves a
marketplace where the guest has no relationship with the hotel and the platform
carries the trust. Our surface is one 8–40 room independent hotel in IT, AT or
SI, and it is the guest's **first** contact with that hotel.

Three consequences, and they drive every deviation in §4:

1. **We do not own inventory.** In V1 the PMS is the source of truth for what
   rooms exist and which are free (ADR-001). We hold a display cache with
   provenance and a freshness stamp, and nothing else. A reference implementation
   can promise a room because it owns the room; we cannot, and pretending
   otherwise would sell a room twice.
2. **The relationship is the product.** The hotel's direct channel exists so the
   guest arrives already known. Funnel tactics that trade a shred of trust for a
   conversion point are a net loss on the second stay, and the wedge is the
   whole journey, not the booking.
3. **Four languages, one of which is nobody's second choice.** IT/DE/EN/SL is
   not decoration in this market. A Slovenian guest booking a South-Tyrolean
   hotel in Slovenian is the differentiator against a German-only engine.

## 3. Re-derive — the flow we build

Four steps, matching E1.2's ceiling exactly, no account at any point.

| # | Step | Asks for | Shows |
|---|---|---|---|
| 1 | **Dates** | arrival, departure, adults, children | the property, its languages, nothing else |
| 2 | **Rooms** | which room type | per-room total for the stay, per-night breakdown, what is and is not included |
| 3 | **Details** | name, email, phone, locale | the chosen room and its total, still visible |
| 4 | **Confirm** | the commitment itself | itemised total, tourist-tax note, cancellation terms, then the reference |

Sprint 4 inserts payment **inside step 4**, below the itemised total and above
the commit control — the placement both references use, and the reason they use
it is that a guest who has read the total and the terms is a guest ready to pay.
The step count does not change.

State lives in the URL as search params, not in a session. Three reasons, in
order of how much they matter: a guest can send the link to whoever is actually
paying; a refresh on hotel wifi at the wrong moment does not restart the
booking; and the surface stays server-rendered, which is what makes the ≤1s
budget in E1.1 achievable without shipping the flow to the client.

## 4. Deviations, each tied to the wedge

**A. The hold is a price hold, not an inventory hold.**
The references hold the room. We record a `hold`-status reservation that fixes
the quoted total and the `rate_snapshots` rows it was computed from, for 30
minutes (E1.3). It does not decrement anything, because in V1 there is nothing
of ours to decrement. Stated plainly here so nobody later reads
`status = 'hold'` as a reservation of inventory and builds on the assumption.
When inventory becomes platform-authoritative, this note changes and so does the
hold — that is a new ADR, not a quiet upgrade.

**B. No urgency or scarcity signals. None.**
No "last room", no "N people viewing", no countdown on the price. Two
independent reasons, either sufficient:

- Binding rule 7: nothing guest-facing states a fact that did not come from a
  tool. We cannot source "2 people are looking at this room" from anything, so
  under our own rules it cannot be said.
- False scarcity is a listed unfair commercial practice in the EU (UCPD Annex I).
  A marketplace with a compliance department can calibrate that line. A hotel
  using our engine cannot, and we would be putting the words in its mouth.

The 30-minute hold expiry **is** shown, because it is true and sourced from the
row.

**C. Stale availability degrades to a request form rather than guessing.**
E1.1's acceptance criterion, and the honest consequence of §2.1. When the
snapshots backing a property are older than the staleness threshold, the surface
says the live prices could not be reached and offers to send the request to the
hotel. It does not show the last known price, and it does not show an empty
result — an empty result reads as "no rooms", which is a lie with the same
outcome as a wrong price.

**D. The tourist tax is a note, not a line in the total.**
In IT/AT/SI the *imposta di soggiorno* is generally collected by the property at
the point of stay, per person per night, with local caps and exemptions. Adding
it to a total the guest pays online would misstate what is being charged;
omitting it entirely produces a surprise at the desk, which is the hotel's
problem and therefore ours. It is rendered as an explicit, separately labelled
note with its own computation, adjacent to the total and never inside it.

**E. Reassurance copy is retained; conversion copy is not.**
Kept, because each is a fact we hold: what is charged now, what is charged at
the property, the cancellation window, that no account is needed, and the
property's own name and contact. Dropped: anything whose purpose is to make
hesitation uncomfortable.

**F. Language is the property's subset, not ours.**
The switcher offers what `properties.languages` declares, not all four. A
property that cannot answer the phone in Slovenian should not present a
Slovenian booking flow — the promise implied by the language switch extends past
the booking, and this is the surface that makes it.

## 4b. Payment, and what "staged" means here

Payment landed in Sprint 4 in the place §3 reserved for it: inside step 4,
below the itemised total, above the commit control. The step count did not
change, which was the test of whether that placement was real or aspirational.

**No payment provider is connected.** The adapter behind it is a simulated one
that moves no money (ADR-010), and the decision to stage it that way is the same
one ADR-008 made for the PMS connector: build against the interface, prove the
whole path, swap the implementation when the commercial side is ready — Stripe
account, Connect Standard onboarding, and the commercialista session on the fee
flow are all 04 §0 items with their own calendars.

What that leaves real, and it is most of it: the deposit comes from the
property's own policy; the `payments` ledger and the `fee_events` row are
written; the provider's webhook is the only thing that confirms a booking
(03 §7.2); the signature on that webhook is checked; redelivery is idempotent;
a lost webhook is recovered by a sweep; and a cancellation computes its refund
from the policy and the ledger before the guest presses anything.

What is fake: the card form, the authorisation, and the money.

**Three deliberate choices about telling the guest.**

*The notice is above the amount, not below the button.* A disclaimer under a
control is a disclaimer nobody reads, and the failure it guards against — a
guest who believes they paid a deposit, arriving to be asked for it again — is
the worst outcome this staging could produce.

*It says what is real as well as what is not.* "Nothing here is real" would make
a guest abandon a booking the hotel genuinely receives.

*It is driven by the adapter's own `simulated` flag, read from the worker.* Not
an environment variable in the web app, and not a name comparison scattered
through the UI. The process that would take the money is the one entitled to say
whether it is real — and when the flag goes false the notice disappears without
anyone remembering to remove it. If the worker cannot be reached, the surface
assumes simulated and warns: a confused guest is a cheaper mistake than a
deceived one.

## 5. What is deliberately deferred

A real payment provider (see §4b), 3DS beyond the interface's
`requires_action` status, guest-initiated *changes* as opposed to cancellation
(E1.4's second half), upsells (E1.7, P2), and multi-room bookings — one room per booking in V1, because the group and
family case is a *preventivo* (E1.8) and gets Slope's quote structure as its own
surface with its own note, not a checkbox bolted onto this one.

## 6. How we will know it worked

E1.1: query to options ≤1s from the cache; locale switch persists; a stale
source produces the request form, verified by ageing the snapshots rather than
by reading the code. E1.2: four steps, no account, confirmation screen and email
inside 60s carrying the booking reference. Both benchmarked against the
references as a guest journey end to end, with any further divergence appended
to §4 rather than left in a commit message.
