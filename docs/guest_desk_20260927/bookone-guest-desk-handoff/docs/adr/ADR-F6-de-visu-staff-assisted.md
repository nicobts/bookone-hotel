# ADR-F6 — De visu: adapter pattern, staff-assisted v1, BookOne never asserts identity
Status: Accepted (module gated) · Date: 2026-09-27

## Context
Consiglio di Stato (Nov 2025) restored mandatory in-person identification for all structures while allowing
"suitable digital tools" (real-time video, video intercom); document upload alone is insufficient. Viminale technical
guidelines were still pending at last check. Face-to-document matching is biometric processing under GDPR.

## Decision
Phase 3 module behind `IdentityVerificationAdapter`. v1 = staff-assisted live video: the agent schedules, runs OCR and
liveness prompts, records with consent, produces the audit record; a hotel employee performs the identification.
v2 = certified KYC vendor behind the same adapter if guidelines permit. Gate: guidelines published AND a written
opinion from an Italian avvocato that v1 complies. BookOne performs no biometric matching.
