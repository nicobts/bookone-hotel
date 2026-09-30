# Pilot onboarding and the 30-day watch (Guest Desk WP1.7)

How a pilot property goes from signed to live, what is watched for 30 days, and how it is switched
back off. It links to the runbooks that own each step instead of repeating them.

**Status.** Written 2026-09-29, before any pilot is signed. **No step here has been done for a real
property.** The monitoring below runs on the demo property. WP1.7's exit criterion is 30
consecutive days, 5 pilots and no manual correction, and it needs signed pilots.

**Stop and ask** before any step marked 🔒. These need the owner's go-ahead: enabling a feature for
a real property, and any filing with an authority.

## Before day one

- [ ] **Contract and DPA** signed. The sub-processor register is current (`docs/runbooks/privacy.md`).
- [ ] **The pilot's filing credentials exist on their side:** Alloggiati Web, WebTur, and the
      comune's portal. BookOne never creates them. The property is always the one filing
      (ADR-020).
- [ ] **Jurisdiction known:** the region as ISO 3166-2 and the comune as its ISTAT code, from the
      region registry (`packages/core/src/compliance/registry.json`). A comune without a rules file
      has no tourist-tax engine; its declaration stays manual.
- [ ] **Owner and staff phone numbers**, with the people told they will be paged (the "Who we page"
      section, `docs/runbooks/privacy.md`, owner and staff contact numbers).

## Day one: the tenant and its modules

1. **Create the property and the owner's account.** Follow `docs/runbooks/onboarding.md`, "Day one:
   make it exist". Set the time zone, the `jurisdiction` and the `accommodationCategory`.
2. **Modules (ADR-019), from the operator console,** each with a reason. Start with the Phase 0 set:
   `inbox`, `concierge`, `prearrival`, `payments`.
3. 🔒 **Filing modules:** `alloggiati` and `istat_regional`. They are switched on only once the
   channel is live for real (see the credentials step below). Until then the property files as it
   does today, and nothing here claims otherwise.
4. **Staff accounts:** `docs/runbooks/onboarding.md`, "The staff account".

## Credentials

- 🔒 **Alloggiati Web:** the property's credentials go into Secret Manager, never into `.env` or a
  database column in clear. Then do the five checks in `docs/runbooks/alloggiati.md`, "Before a
  single real submission". The channel is the software-house web service once it is registered,
  but registering it is not enough: the real endpoint and the Secret Manager `CredentialSource` are
  not built yet, and the adapter refuses any host but the simulator
  (`docs/adr/IMPLEMENTATION-STATUS.md`). Until both exist this step stays blocked, the `alloggiati`
  flag stays off, and the property files by hand as it does today.
- **WebTur:** waits for the Regione's specification (`docs/runbooks/compliance.md`, WP1.3). Until
  then the property files the day's return by hand from **Adempimenti**, and records it there.
- **Tourist tax:** waits for the comune's regolamento and the collection ADR (WP1.4).

## The WhatsApp number

`docs/runbooks/whatsapp.md`, "Before a real property uses it": Meta verification, the templates
and the sender. Today there is **one sender per deployment**, so only one pilot per deployment can
have WhatsApp on. Pilots after the first use email and the booking page until per-property numbers
exist. 🔒 Switching `whatsapp` on is an operator action with a reason.

## Content

`docs/runbooks/onboarding.md`, "Day two: the knowledge base": ingest the property's own website,
then have the owner review every draft article. Nothing reaches a guest from an unreviewed draft.
Check the assistant's answers in the agent preview on **Agenti** before go-live.

## Staff training: one hour

At the property, with the desk's own screen. Each part ends with the person doing it themselves.

| Minutes | What | They can do it when |
|---|---|---|
| 0–10 | **Oggi** and **Eccezioni**: the day's shape, and the only list that needs them | they can say what an empty inbox means |
| 10–25 | An arrival: the party, the documents, **Conferma**, and the Questura filing's state | they have confirmed one demo arrival |
| 25–40 | **Adempimenti**: what is due, and filing by hand. Download the file, file it on the portal, record the protocol and the receipt | they have recorded one filing on the demo |
| 40–50 | **Conversazioni**: taking over a thread, handing it back, and what the assistant will never do | they have answered one demo guest |
| 50–60 | Alerts on their phone, and who to call when something looks wrong | they know the rollback below exists |

Train on the demo property (`pnpm demo:seed`), never on the pilot's live guests.

## Go-live checklist

- [ ] Property, owner and staff accounts exist; each person has signed in once.
- [ ] Phase 0 modules on, and each checked from the console as the owner.
- [ ] Knowledge base reviewed by the owner; the agent preview answers the ten most common questions.
- [ ] Owner and staff numbers recorded, and people told they will be paged.
- [ ] 🔒 Filing modules on only if the channel is really live; otherwise the property keeps filing
      by hand and records it in **Adempimenti**.
- [ ] Training done, with the table above ticked for each person.
- [ ] The operator has opened the property in the operator console and seen its **Pilot week** card.
- [ ] Rollback explained to the owner.

## The 30-day watch

**Every morning (operator), in the operator console:**
- **Health → Filings, last 7 days.** Any number under *Missed* is a filing still not with the
  authority after its deadline. Call the property the same morning. Filing late is the property's
  liability, not ours, and they must hear it from us first.
- **Health → queues.** Nothing should be failing on `compliance.*` or `alloggiati.*`.

**Every Monday (operator):**
- Open the property, **Pilot week** card. It shows last week against the plan's targets:
  - no missed filing;
  - at least 70% of conversations resolved without a person;
  - a median first response within 30 seconds;
  - zero unsafe actions (the tool-boundary audit);
  - interruptions halved against the pilot's first week.
- Copy **The report for the owner** and send it to them. It holds counts only, never a guest.
  Until an email provider is chosen, it is sent by hand, from the operator's own mailbox.
- **Not measured by the product:**
  - escalation precision, which needs someone to label each escalation as right or wrong;
  - guest satisfaction, because no survey is sent.

  Record both by hand in the pilot's notes if the plan needs them.

**Manual correction.** The exit criterion is 30 days with no manual correction. A correction is any
change made outside the product to make a filing or an answer right: fixing a filing on the portal
afterwards, or editing a record in the database. A filing made by hand and recorded in
**Adempimenti** is the fallback working as designed, not a correction. Log each correction with its
date and cause in the pilot's notes; the 30 days restart after one.

## Rollback

In order, stopping as soon as the problem is contained:
1. **Pause the concierge** (operator console, with a reason). Every guest message goes to the
   staff; no model runs. It takes effect on the next message.
2. **Switch a module off** (operator console, with a reason). The property can no longer reach it
   and its jobs stop (ADR-019). Obligations already created stay, and are visible and recordable in
   **Adempimenti**.
3. **File by hand.** Every filing has its manual route: the file for the portal and the form that
   records it (`docs/runbooks/compliance.md`, "The manual fallback"). Nothing is lost by switching
   the automatic channel off.

Nothing here deletes data. Ending a pilot for good follows the contract and the retention periods in
the data map, not this runbook.
