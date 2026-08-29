# Design note — pre-arrival check-in (`/[locale]/stay/[token]`)

**Surface:** the guest's own pre-arrival page, Sprint 5 (04 §1 Phase C).
**Stories:** E2.1, E2.2 (P0). E2.3 filing and E2.4 destruction consume what this
surface collects; E3.1 arrival and E4.1 departure extend the same page in
Sprint 7.
**Reference (08 §3, ADR-014):** Mews Kiosk flows, transposed to the guest's
phone.
**Adopted:** step logic and document-capture ergonomics.

> **Written after the surface, not before it.** ADR-014 requires the note first
> and Sprint 5 did not produce one — the reference was studied and the
> deviations were argued in code comments, but the note that makes that
> auditable was skipped. This records the reasoning as it stood; the process
> failure is recorded honestly rather than backdated, and the Sprint 7 notes
> were written before their surfaces.

---

## 1. Understand — what the reference does, and why it works

A kiosk check-in is a queue-avoidance machine. Its shape is fixed by the fact
that a person is standing at it, in a lobby, possibly with a queue behind them:

- **One thing per screen.** A kiosk asks for a document, then confirms the
  details it read, then takes a signature. It never shows two questions at
  once, because a standing person reading a wall-mounted screen loses their
  place.
- **Scan first, type never.** The document is the input. Typing is the fallback
  when the scan fails, not the primary path.
- **The property already knows most of the answer.** The reservation supplies
  dates, room and rate; the guest confirms rather than supplies.
- **Completion is visible and final.** The kiosk ends by producing something —
  a key, a card, a code. The guest leaves holding proof the task is done.

The last point is the one that carries the most weight and is the easiest to
lose: a self-service flow that ends with "thank you" and no artefact leaves the
guest wondering whether to go to the desk anyway, which costs the property the
staff minute it was trying to save.

## 2. Validate for our buyer

Three things about a small independent hotel in IT/AT/SI break the kiosk
assumption:

**There is no lobby to stand in.** A ten-room *garni* has a desk that is staffed
four hours a day. The check-in is not happening in the building; it is happening
on a train, two days before arrival, in a language the property may not speak.
Hardware kiosks are explicitly out (08 §3: "we deliberately skip hardware
kiosks — phone-native is the small-hotel answer").

**The legal payload is heavier than a kiosk's.** A kiosk in a chain hotel feeds
a PMS that a night auditor later files from. Ours feeds Alloggiati directly
(E2.3), which files *surname and given name separately*, plus sex, citizenship,
birth place and document details, per person, for every guest including
children. The reference's "confirm what we read" screen has nothing like this
volume.

**Nobody is behind them in the queue.** This is the one deviation the phone buys
us: a guest on their sofa can stop halfway and come back. A kiosk cannot offer
that, so it does not have to be designed for it — and we must be.

## 3. Re-derive — the surface we build

One page, not a wizard. Three sections, each saving independently:

| Section | Asks for | State it moves |
|---|---|---|
| **Your details** | per guest: surname, given name, sex, birth date, birth country, citizenship, document | `precheckin`, and `documents` when a file came with it |
| **Your documents** | one photo per named guest | `documents` |
| **When you arrive** | expected arrival time | `arrival` → `expected` |

Access is a signed token in the URL, no account (ADR-013 discipline: a guest who
has to create a password to tell us when their train arrives will not tell us
when their train arrives).

## 4. Deviations, each tied to the wedge

**(A) One page with independent sections, not a linear wizard.** The kiosk's
one-question-per-screen rule exists to serve a standing person under time
pressure. Our guest is neither. A wizard on a phone, done two days early, means
losing everything on a refresh or a tab switch — and a party of four means
sixteen screens. Each section posts on its own, so the page is resumable at no
cost to the guest and at the cost of one extra form action to us.

**(B) The form asks for surname and given name separately.** The obvious design
collects "full name" and splits it. Splitting is a guess, and it is wrong for
exactly the guests this market has: Spanish double surnames, Hungarian
name order, any name with a particle. A wrong split files a real guest under a
name that is not theirs, and the property carries that. So we ask.

**(C) Sex and citizenship are asked, not inferred.** Neither can be derived from
anything else we hold. They are legally required fields (E2.3), and the honest
version of "we need this" is a labelled field with the reason beside it, not a
silent lookup that is wrong for dual nationals.

**(D) Document capture is upload, not scan.** The reference's scanner is
hardware. A phone camera photograph into private EU storage is the
transposition — and the extraction that would make it feel like a scan (AG-02,
06 §2) reads the photo *after* upload rather than gating on it. A guest whose
photo will not parse still gets to finish.

**(E) The page states what is outstanding, from the state machine.** Not from a
per-screen flag. `outstandingForGuest()` in the journey machine is the single
definition of what is left, so the guest's page and the owner's console can
never disagree about whether this stay is ready — which is what makes the
console an exception surface (D15) rather than a second opinion.

**(F) No "you are checked in" until every named guest has a document.** The
first build said it after the first upload, because the journey's `documents`
dimension is stay-level. A party of two with one photo read as complete. The
page now derives completeness from the named party; the journey dimension is
unchanged, because it is answering a different question — whether *any*
document is held, which is what the deletion job (E2.4) needs.

## 5. Deliberately deferred

- **Signature.** The reference takes one. Alloggiati does not require it, and a
  signature we do not need is PII we would have to delete.
- **Room assignment and key issue.** Sprint 7 (E3.1) and the Rooms hook (E4.2).
- **Payment on this surface.** Deposit is taken at booking (Sprint 4); a balance
  request here would duplicate the departure settlement (E4.1).
- **Extraction prefill (AG-02).** The fields exist and are typed to the
  Alloggiati set precisely so extraction can fill them later without a
  re-design. The guest confirms either way — the guest is the confirming human.

## 6. How we will know it worked

E2.1's DoD is a median completion of ≤5 minutes measured with five test users,
which has not been run. The instrumentation for it is the journey transitions
themselves: `precheckin.invite` to `precheckin.submit` per stay, which are
already evented.
