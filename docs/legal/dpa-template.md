# Data processing agreement — template (DRAFT, for counsel)

**Status: draft, 2026-09-27. Not reviewed by counsel. Do not send to a hotel as final.**
Plan §4 acceptance item. Everything factual below is taken from the code and the
generated documents it names, so it describes what the platform does, not what it
was meant to do. The open questions at the end are for counsel.

## The approach: the Commission's clauses, not our own

Use the **Standard Contractual Clauses between controllers and processors
(Commission Implementing Decision (EU) 2021/915, Article 28(7) GDPR)**, adopted
verbatim, with the annexes below completed. That is common practice for a small
EU processor. The clauses are already written to satisfy Art. 28(3), a hotel's
advisor recognises them, and nobody has to review bespoke wording.

- Clause 7.7 (use of sub-processors): **Option 2, general written authorisation**.
  The notice period is set below, and changes are notified through the register.
- Clause 9 (personal data breach): the deadline is fixed in Annex II.
- Liability, fees and term stay in the main service agreement. The clauses take
  precedence over it on data protection (Clause 4).

**Roles.** The hotel (the property) is the **controller**. BookOne is the
**processor**. The guest exercises rights against the hotel, and BookOne supplies
the tools (the console's Privacy page). For identity data filed with the
Questura under TULPS art. 109, the legal obligation is the hotel's. BookOne
transmits it on the hotel's instruction and never on its own account.

---

## Annex I — List of parties

- **Controller:** the property. Legal name, address, VAT number, contact person
  and email, as in the service agreement.
- **Processor:** BookOne. Legal entity to be confirmed; RT Holding Group GmbH
  appears in the product's footer. Contact for data protection: to be named.

## Annex II — Description of the processing

**Categories of data subjects**
- Guests of the property, and the people travelling with them.
- The property's owners and staff who use the console.
- People who write to the property through the booking page before they have a
  booking.

**Categories of personal data**
- Identification and contact data: name, email, phone, language.
- Stay data: dates, room, party composition, requests, arrival time.
- **Identity documents**, as the law requires for registration: document type,
  number, issuing country, date and place of birth, citizenship, and a photo of
  the document.
- Messages exchanged with the property through the stay page, including those
  answered by the automated assistant.
- Payment status and references. **No card data reaches BookOne.** The payment
  provider holds it, and BookOne stores intents and references only.
- Console users: account email, role, sign-in metadata.

**Sensitive data.** None is sought. A guest may volunteer health information in a
message, for example an allergy or an accessibility need. Medical emergencies
and health or safety complaints are always handed to a person (hard rules and
the complaints profile). Other health mentions are handled like any message and
retained like one.

**Nature and purpose of the processing**
- Taking and managing direct bookings.
- Pre-arrival collection of the data the property is legally required to
  register, and preparation of the registration record for a person at the
  property to confirm.
- Guest messaging, including automated first-line answers drawn only from what
  the property wrote. Anything involving money, identity or an emergency goes to
  a person.
- Notifications about the stay.
- Reports to the property on what the platform did (the invoice basis, D14).

**Duration.** For the term of the service agreement, then deletion as in
Clause 10 (see "End of contract" below).

**Retention.** Generated from the same declaration the deletion jobs run
(`packages/core/src/privacy/data-map.ts`). The owner sees the full table on the
console's Privacy page. The periods relevant to guests:

| Data | Period |
|---|---|
| Identity-document photos | Deleted when the filing is acknowledged, or 1 day after departure when the property files elsewhere (configurable per property) |
| Registration record fields | 30 days |
| Transmitted filing payload | 2 years; checksum and receipt kept as proof of filing |
| Messages, requests, complaints, notifications | 2 years |
| Guest identity and contact data | Cleared after 10 years; reservations deleted after 10 years (fiscal-adjacent floor, PRD D6) |
| Automated-assistant run details | Tool inputs and outputs cleared after 2 years |

**Location of storage.** The EU (Supabase, Frankfurt). The EU sub-processor
entries are in the register.

**Processing outside the EU (ADR-029).** Guest message text and, where the
property enables automatic document reading, document images are sent for
processing to a model gateway (OpenRouter) whose processing may take place
outside the EU. Nothing is stored there:
- requests are made with zero data retention and with data collection for
  training refused;
- the transfer mechanism is the 2021/914 SCCs in the gateway's own DPA;
- document reading is off by default, per property.

The guest privacy notice on the stay page says so. This is the point counsel
must confirm is acceptable (question 1 below).

## Annex III — Technical and organisational measures

Each measure names where it lives, so it can be checked.

**Tenant isolation**
- Row-level security on every client-reachable table, scoped to the property.
- A cross-tenant test suite is a merge gate.
- Every policy and the date it was last verified by query are in
  `docs/runbooks/rls-policies-map.md`.

**Access by BookOne staff**
- Only through an audited operator console, with its own identity store,
  mandatory MFA, network access over Tailscale only, and a reason recorded for
  every action.
- Read-only access to a property is limited to 30 minutes, excludes message text
  and documents, and is shown to the property in its console settings.
- The operator trail is append-only at the database. See ADR-031.

**Encryption**
- TLS in transit everywhere.
- Encryption at rest by the database and storage provider.

**Secrets**
- Never in the repository.
- Held in a secrets manager on the host (ADR-032).

**Minimisation**
- Document photos are the shortest-lived data in the system.
- The automated assistant states only facts returned by the platform's own
  tools, never generated prices, dates or availability.
- Operator views exclude message text and documents.

**Guest rights.** Export and erasure run from the console's Privacy page. Each
request is recorded with its one-month deadline. The limits of erasure (fiscal
records, filings with a public authority, Art. 17(3)(b)) are shown before the
button.

**Backups and restore.** Provider point-in-time recovery, plus a logical exit
dump. Drills are logged in `docs/runbooks/backup-restore.md`. **The PITR drill
has not been run yet**, and it is listed as a blocker before general
availability.

**Breach notification.** The processor notifies the controller without undue
delay and **within 48 hours** of becoming aware. The notice includes what
Art. 33(3) requires, so the controller can meet its own 72 hours. The 48 hours is
a proposal for counsel.

**Webhooks and ingress**
- Signature verification and idempotency.
- Rate limits and size caps.
- No internal surface has a public ingress.

## Annex IV — Sub-processors

The generated register, `docs/legal/sub-processor-register.md`, **is** this
annex. It is produced from code, CI fails if it drifts, and it shows each
provider's status (in use, staging, planned, undecided).

- **Proposed notice period** for adding or replacing a sub-processor: 30 days,
  by email to the controller's contact. The controller may object on reasonable
  data-protection grounds.

## End of contract

On termination, the controller may export its data through the console for 30
days. After that, BookOne deletes it from the live system.

Backups age out under the provider's point-in-time window. Erasure applies to
backups as they expire rather than by rewriting them. This matches
`docs/runbooks/backup-restore.md` ("the retention question"), and it has to be
stated here in words.

---

## Open questions for counsel

1. **Model processing outside the EU (ADR-029).** Is the combination acceptable
   for a hotel controller in Italy/Austria/Slovenia, and does the notice need
   more than it says?
   - Zero retention, no training, and the 2021/914 SCCs.
   - Message text in scope, document images only on opt-in.
2. **Document images at all.** Is sending an identity-document photo to a vision
   model proportionate, or should automatic reading stay limited to the
   machine-readable zone captured on the device? It is off by default today.
3. **The 10-year floor** for reservations and guest identity (PRD D6), and the
   2-year period for filing payloads. Both are our readings, not given periods.
4. **Breach notice: 48 hours.** Is it acceptable, or should it be 24?
5. **Legal entity and establishment of the processor**, and whether an EU
   representative is needed.
6. **Health information volunteered in messages.** Is ordinary message handling
   and retention enough for an allergy or accessibility note? Or should the
   assistant hand every health mention to a person, with a shorter retention?
