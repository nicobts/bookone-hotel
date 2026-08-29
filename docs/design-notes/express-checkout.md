# Design note — arrival and express checkout (`/[locale]/stay/[token]`)

**Surface:** the last two states of the guest's own page, Sprint 7 (04 §1
Phase C).
**Stories:** E3.1, E4.1 (P0). E4.2 credential revocation is a Rooms hook and is
interface-only here.
**Reference (08 §3, ADR-014):** Mews Kiosk flows transposed to the guest's
phone, same row as [pre-arrival](pre-arrival.md) — a kiosk's job is check-in
*and* check-out, and the second half of it is what this note is about.
**Adopted:** the "settle then leave" sequence, the folio-summary-before-payment
convention, and the fact that departure is confirmed rather than assumed.

---

## 1. Understand — what the reference does, and why it works

Express checkout in a kiosk or a PMS is a four-beat sequence, and the order is
not arbitrary:

1. **Show the folio.** Everything charged to the room, itemised, before any
   payment step. A guest who is asked to pay before seeing the lines will find a
   member of staff to ask what the lines are — which is the queue the feature
   exists to remove.
2. **Settle the balance** with the card already on file.
3. **Say where the invoice goes.** Email, address, company details.
4. **Confirm departure** and release the room.

The reason it works is that it converts a conversation into a confirmation. The
guest already knows what they ate; they need to see that the hotel agrees, and
they need a receipt. Nothing about it is a negotiation, and treating it as one
by hiding the total until the end is what makes people queue.

Arrival, at the other end, is the same insight run backwards: the kiosk's value
is that a guest who has already done the paperwork walks past the desk. The
completion event does several things at once — it posts a check-in, it triggers
the legal filing, and it gives the guest what they need to get into the room.

## 2. Validate for our buyer

**We do not hold the folio.** This is the deviation that shapes everything
below. A PMS owns extras — the minibar, the dinner, the spa — and in our
architecture that is Ericsoft behind an adapter (ADR-008), currently a mock. We
know only what *we* registered: the stay, the deposit taken, the platform-side
extras. A checkout screen that presents our partial view as "your bill" would be
wrong in the one direction a guest notices.

**We issue nothing fiscal, ever.** D11 and binding rule 6. In Italy the
*fattura*, the *corrispettivo* and the SDI transmission are the property's
obligations discharged through their own certified chain. Not a compliance
nicety to sequence later: a checkout flow that emailed a document that *looked*
like a receipt would be the single fastest way to give a hotel a real problem.
So the invoice step is a **request routed to the property**, and what the guest
gets from us is a statement of what they paid, labelled as exactly that.

**The payment provider is simulated** (ADR-010, Sprint 4). Every amount on this
surface carries the simulated-payment notice, and settlement moves no money.

**A ten-room property does not have automated key revocation.** E4.2 is a Rooms
hook. Departure here emits the event a Rooms module would subscribe to, and that
is the whole of it — an interface, not a stub that pretends.

## 3. Re-derive — the surface we build

The stay page grows two states beyond pre-arrival, driven by the journey's
`arrival` and `departure` dimensions:

| Journey state | What the guest sees |
|---|---|
| `arrival: expected` | what is outstanding, and — on the day — **I have arrived** |
| `arrival: confirmed` | the welcome: how to get in, what the property wants them to know, and the message thread |
| departure day, `departure: pending` | **Check out** — what we know they paid, what we do not, the invoice request, and a confirm |
| `departure: settled` | confirmation, the review link, and the thread still open |

**Arrival confirmation** is one journey command (`arrival.confirm`) with three
possible triggers — guest tap, staff tap (built in Sprint 6), and a door event
from Rooms (interface only). Completion posts the check-in to the PMS through
the adapter, fires the Alloggiati filing, and sends the welcome.

## 4. Deviations, each tied to the wedge

**(A) The checkout screen states what it does not know.** Where the reference
shows a folio, we show "what you have paid us" and, beside it, a plain sentence
saying that anything charged at the property — the bar, the restaurant, the
minibar — is settled with the property directly. This is the honest rendering of
a partial view, and it is better than a total that is confidently short.

**(B) The invoice is a request, not a document.** One field — who the invoice is
for — routed to the property and to the PMS through the adapter. We generate no
PDF, assign no number, and transmit nothing to anyone. The guest gets a
confirmation that the request reached the property, which is a true statement
about something that happened.

**(C) Departure is confirmed by the guest, not inferred from the date.** A guest
who leaves at 06:00 without touching the page has still left, and a nightly
sweep closes the stay — but the sweep records a different actor and a different
origin from a guest tap, because "the guest told us they left" and "the date
passed" are different facts and the second one is occasionally wrong. `settled`
and `closed` are separate states for exactly this reason.

**(D) The review request is sent after departure is confirmed, not on the
checkout screen.** The reference asks while the guest is still standing there,
which is where the response rate is. It is also where the answer is least
informative and, under the EU rules on review solicitation, where an incentive
placed next to a payment step gets uncomfortable. It goes out afterwards, once,
through the notifications outbox, and it is not conditional on anything the
guest said.

**(E) The welcome message contains only facts a tool produced.** Binding rule 7
applies to this as much as to the concierge: door code, room, wifi and arrival
instructions come from the property record or the PMS adapter, and a field the
property has not filled in is simply absent from the message rather than
plausibly filled.

**(F) No upsells at checkout.** The reference monetises this screen — late
checkout, a transfer, a room upgrade for next time. Each of those touches money
or dates, which is T2 (06 §2), which needs the proposal surface Sprint 8 builds.
Shipping them as one-tap purchases against a simulated payment provider would be
the worst version of both.

## 5. Deliberately deferred

- **Real folio from the PMS.** The adapter method exists and the mock answers
  it; the real one lands with the real adapter (ADR-008).
- **Key revocation (E4.2)** — Rooms hook; departure emits the event.
- **Late-checkout purchase, transfers, upgrades** — see (F).
- **Anything fiscal** — D11, permanently, until C1–C6 are verified in writing.

## 6. How we will know it worked

- Share of departures confirmed by the guest rather than by the nightly sweep.
- Arrivals completed without a staff tap — the zero-touch metric (G1), which is
  computed off the journey transitions this sprint completes.
- Zero fiscal artefacts generated. Enforced by absence: no such code exists.
