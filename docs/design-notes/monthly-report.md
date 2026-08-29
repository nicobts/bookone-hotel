# Design note — the monthly report (`/[locale]/[property]/console/report`)

**Surface:** the owner's monthly revenue and fee statement, Sprint 8 (04 §1
Phase D).
**Stories:** E5.4 (P0). It is the invoice basis (PRD C4), which is what makes it
the highest-stakes read-only screen in the product.
**Reference (08 §3, ADR-014):** **08 §3 names no reference for this surface.**
This note proposes one and argues the deviations; the table gains the row, as it
did for in-stay messaging in Sprint 7.
**Proposed reference:** the usage-billing statement pattern as practised by
metered developer platforms (Stripe's own billing dashboard, AWS Cost Explorer)
— studied from public product documentation and pricing pages only.
**Adopted:** the period selector, the subtotal-by-line-type breakdown, the
drill-down from a charge to the events that produced it, and the export.

---

## 1. Understand — what the reference does, and why it works

A usage bill has one hard problem: the customer did not agree to the number in
advance, so the statement has to *earn* it. The pattern that solves it is
consistent across every platform that bills this way:

- **The total is decomposed before it is stated.** Base plus metered lines,
  each with its own quantity and rate, and the arithmetic visible.
- **Every line drills to the events behind it.** Not a summary of them — the
  actual records, with identifiers a customer can look up on their own side.
- **The rate is shown next to the charge**, not in a contract elsewhere.
- **The period is frozen.** A statement that changes when you reopen it is not a
  statement, and the good implementations say when it was issued.
- **There is a way to argue.** Support ticket, dispute button, credit note — the
  route exists and is visible from the line.

The reason it works is that it converts "trust us" into "check us". The
statement is designed to be audited by someone who suspects it, which is the
only design that survives being audited by someone who suspects it.

## 2. Validate for our buyer

**They will read it, and they will read it adversarially.** A ten-room owner
signing a percentage-of-revenue deal with a young company is exactly the person
who checks the arithmetic. That is not a problem to design around; it is the
design brief. M6 (trust architecture) is a moat only if the statement holds up.

**They compare in €/room/month.** The market has been educated in that unit
(D20, ADR-015) and our hybrid model is incomparable as stated. Every version of
this screen shows the per-room equivalence **including the percentage fees** —
the number shown is the number billed, or the trust the report exists to build
is the thing it destroys.

**The AI-attributed line is the one that will be argued about.** It is the
higher rate (D14: 8–12% against 2–4%), it is the newer claim, and it is the one
where the platform's interest and the owner's diverge. Which is why the
attribution rule is conservative, why every attributed line carries its evidence
chain, and why **a dispute resolves in the owner's favour** — stated in D14 and
implemented literally.

**Nothing here is a fiscal document.** D11 and binding rule 6. This is the basis
from which *we* invoice *them*, not anything the property issues to a guest, and
not anything transmitted to any authority. The export is a working document with
that said on it.

## 3. Re-derive — the surface we build

One screen per property per month:

| Section | Shows |
|---|---|
| **Header** | the period, whether it is a draft or issued, and when it was issued |
| **Equivalence** | €/room/month for this property, this month, fees included |
| **Lines** | subscription, direct-booking fees, AI-attributed fees — each with count, basis, rate and total |
| **Drill-down** | per line, the bookings behind it: reference, guest, dates, basis, fee, and for attributed rows the evidence |
| **Disputes** | a flag per booking, and what happened to it |
| **Export** | CSV and a printable statement |

## 4. Deviations, each tied to the wedge

**(A) The report is frozen when issued, and stored as a snapshot.** The
references recompute a period on read, which is fine when the underlying meter
is append-only and beyond argument. Ours is not: a reservation can be cancelled,
a fee can be disputed, a rate card can change. So issuing writes the numbers
down. A statement that quietly changed between two readings would be the single
fastest way to lose the argument this whole surface exists to win.

**(B) A dispute is resolved in the owner's favour, by construction.** Not a
workflow with an adjudication step — the credit is applied when the dispute is
raised, and the conversation happens afterwards. D14 says disputes resolve
owner-favourable; anything else is a policy that reads well and behaves
differently under load. The cost of being wrong is one fee; the cost of the
alternative is the owner deciding the numbers are a negotiation.

**(C) Attribution has to be *earned* per booking, and the default is the cheaper
fee.** A booking is AI-attributed only when a concierge session produced it and
no engine session preceded it inside the window. Every ambiguous case falls to
`direct_booking`, which bills less. Sprint 4 shipped a stricter proxy than the
published rule because the timestamps did not exist yet; Sprint 8's
`attribution_events` gives us the real window — and note the direction: the real
rule can only ever move a fee **up** from the proxy, which is a conversation to
have rather than a refund to make.

**(D) The evidence is stored with the fee, not reconstructed.** The references
can regenerate a line from their event stream because their event stream is the
product. Ours describes a business that keeps moving: a guest is anonymised
under E8, a reservation is cancelled, a session expires. An evidence chain
rebuilt six months later against a database that has moved on is not evidence.

**(E) No forecast, no "projected spend", no optimisation nudges.** Every metered
platform grows these and they are good for the platform. Here the same widget
would be the company that bills on revenue telling a hotel how to make more
revenue — and the report's only job is to be checkable. Anything on the screen
that is not verifiable weakens everything that is.

**(F) The export says what it is not.** A PDF with amounts on it, emailed to a
hotelier in Italy, will be forwarded to a commercialista. So it carries a line
saying it is a working statement and not a fiscal document, in the property's
language. Cheap to write, expensive to omit.

**(G) Zero is shown, not hidden.** A month with no AI-attributed bookings shows
that line at €0 rather than dropping it. An owner who never sees the line cannot
form a view about whether the number is fair, and the first month it appears it
looks like something new was introduced.

## 5. Deliberately deferred

- **Actual invoice issuance and collection.** This is the *basis*. Our own
  billing runs elsewhere, and nothing here computes VAT or issues a document.
- **Multi-property roll-up.** An operator with three houses reads three reports
  in V1. Consolidation is a Sprint 9+ concern once entitlements exist.
- **Module and per-room fees (D14 row 4).** Entitlement flags are Sprint 9; the
  line is designed for but not populated.
- **Automated dispute adjudication.** The credit is automatic; the conversation
  is a human one, and should be.

## 6. How we will know it worked

- The DoD is a design partner accepting it as an invoice basis, which is a
  judgement rather than a metric — and correctly so.
- **AG-07 finds zero unevidenced attributed fees.** An attributed line whose
  evidence does not hold is a line we should not have billed, and the auditor is
  what makes that a measurement rather than a hope.
- Disputes raised, and their share of attributed lines. A rate that climbs means
  the attribution rule is wrong, not that owners are difficult.
