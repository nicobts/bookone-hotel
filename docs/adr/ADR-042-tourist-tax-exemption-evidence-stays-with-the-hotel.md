# ADR-042 — A tourist-tax exemption is stored as a code; its evidence stays with the hotel

**Status:** Accepted (owner, 2026-09-30) · **Date:** 2026-09-30
**Depends on:** ADR-020 (registration reporting is not fiscal core) · **Supersedes:** nothing

## Triggering event

WP1.4's engine applies declared exemptions by code (`taxExemption` on the registration record), and
`docs/runbooks/compliance.md` left open where the code and its evidence are kept. Some exemption
reasons are special-category data under GDPR Art. 9: "accompanying a patient at the local hospital"
says something about someone's health. That has to be settled before a real comune's rules go live
and before anyone builds the screen that records an exemption.

## Context

- Since DL 34/2020 art. 180 the hotel is *responsabile d'imposta*. It must keep the documentation
  behind every exemption (usually a signed self-declaration, sometimes a certificate) and show it to
  the comune on request. How long is the comune's regolamento to say; what the law fixes is the
  comune's window to assess, which closes on 31 December of the fifth year after the declaration
  was due (L. 296/2006, art. 1 c. 161). The evidence has to outlast that window.
- To compute the tax and write the declaration, BookOne needs only **which** exemption applied. It
  never needs the document.
- Storing scanned certificates would make BookOne a processor of health data at scale: stricter
  security, a DPIA, a sub-processor register entry, for no product value.

## Decision

- **BookOne stores the exemption's code, never its evidence.** No upload, no photo, no free-text
  reason. The code is one of the `reason` exemptions in the comune's rules file.
- **The hotel keeps the signed declaration**, on paper or in its own archive, as it does today. When
  an exemption is recorded, the desk shows a reminder: "exemption declared, keep the signed form".
- **The code's lifetime:** on the registration record it goes with the 30-day purge. After that it
  survives only as a count, by code, in the stay's frozen tax record (ADR-043), with no name attached.
- Storing evidence later, if pilots ask for it, needs a new ADR with its own DPIA.

A change complies if no table, bucket or log holds anything about an exemption beyond its code,
and if nothing ties a code to a name after the registration record is purged.

## Cost of change / cost of not changing

**If wrong:** adding evidence storage later is a new, isolated feature. Nothing built here has to be
undone.

**If not done:** the first exemption screen invents its own answer, most likely an upload field,
and certificates with health data land in a general bucket. It would be discovered in an audit or a
breach.

## Alternatives rejected

- **Upload the evidence to a separate encrypted bucket.** It can be done, but it takes on Art. 9
  processing to save the hotel a folder. Revisit only on a pilot's request.
- **Store a generic "exempt" flag without the code.** The comune's declaration counts exemptions by
  reason, so the code is the minimum needed.

## Consequences

- The exemption screen, when it is built, is a picker of codes from the rules file plus the
  reminder, and nothing else.
- The hotel's paper archive stays the evidence of record. The runbook says so.
