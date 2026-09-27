# ADR-027 — BookOne never asserts a guest's identity; de visu is staff-assisted behind an adapter

**Status:** Accepted (module gated) · **Date:** 2026-09-27
**Depends on:** ADR-008, ADR-019 · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F6 and the IdentityVerificationAdapter half of ADR-F3

## Triggering event

The Consiglio di Stato (November 2025) restored mandatory in-person identification of guests while
allowing "suitable digital tools" such as real-time video; uploading a document alone is
insufficient. The Viminale's technical guidelines were still pending at last check. Pre-arrival
capture already stores document images (Sprint 5), and WP0.4 adds OCR — the obvious next step,
matching a face to a document, is biometric processing under GDPR Art. 9.

## Decision

- **BookOne never produces an identity assertion.** A hotel employee, or a certified vendor, asserts;
  BookOne records who asserted, how, and when. No BookOne component returns "identity verified".
- **No biometric matching**: no face comparison, no liveness scoring used as an identity decision.
- An `IdentityVerificationAdapter` port declares its **mode** (staff-assisted video; certified
  vendor), **consent requirements**, and the **evidence** it produces.
- **v1 is staff-assisted live video**: the agent schedules the call, runs OCR on the document shown,
  records with consent, and produces the audit record; the employee performs the identification.
  **v2** is a certified KYC vendor behind the same port, only if the guidelines permit.
- **Gate (Phase 3):** Viminale guidelines published **and** a written opinion from an Italian
  avvocato that v1 complies. The feature has no entitlement key until then.

## Cost of change / cost of not changing

**If wrong:** the gate delays a feature; nothing is built that must be unbuilt.

**If not done:** OCR plus a stored photo is one step away from "verified" appearing in a UI, which
would be a claim BookOne cannot make and a biometric processing activity it has no basis for.

## Alternatives rejected

- **Automated face-to-document matching.** Biometric processing, and an identity assertion by the
  platform.
- **Build v1 now, gate the rollout.** The legal shape of v1 depends on guidelines that do not yet
  exist; building ahead of them is building to a guess.

## Consequences

- Pre-arrival capture (WP0.4) extracts and validates fields — MRZ check digits are arithmetic, not
  identity — and ends at `staff_confirmed`.
- Guest-facing text never says a guest is identified or verified (hard rule, ADR-021).
