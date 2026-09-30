# ADR-041 — Manual-filing receipt files are kept five years

**Status:** Accepted (owner, 2026-09-30) · **Date:** 2026-09-30
**Depends on:** ADR-039 (obligations and evidence) · **Supersedes:** nothing
**Amends:** the `compliance_attachments` retention in `packages/core/src/privacy/data-map.ts` (WP1.6 set two years)

## Triggering event

WP1.6 built filing by hand: the desk uploads the receipt the police portal gives, and
`receipts.purge` deleted the file two years after upload. Two years was a placeholder of ours,
marked "for counsel" in `IMPLEMENTATION-STATUS.md`. Before the first pilot files by hand, the
period has to be one we can defend.

## Context

- The receipt is the property's proof that it filed on time. The fingerprint (SHA-256) in
  `compliance_evidence` stays forever, but a fingerprint proves nothing without the file to compare.
- The Ministry of the Interior keeps Alloggiati data for five years, and the standing advice to
  hotels is to keep every receipt for the same five years. A filing can be questioned for as long as
  the authority holds it.
- A portal receipt may list the guests' names. That is why the file goes at all.
- Automatic filings are not affected: their receipt is JSON in `compliance_evidence`, never carries
  a guest's details (adapter contract), and is kept while the property is a client.

## Decision

- `RECEIPT_RETENTION_DAYS` is **1827** (5 × 365 + 2, so any five calendar years are covered).
  `receipts.purge` deletes a manual-filing receipt file five years after upload. The row is stamped
  `deleted_at` and the evidence keeps the hash, as before.
- `alloggiati_submissions.payload`, our copy of the transmitted text with every guest's name, **stays
  on two years**. The portal's receipt is the proof, not our copy of the names, so keeping the names
  longer buys nothing.
- An erasure request still does not remove a receipt early (Art. 17(3)(b)); the desk gives the
  requester the five-year date.
- Counsel confirms the period in writing before a real property files by hand. If counsel sets a
  different period, a new ADR supersedes this one.

A change complies if every manual-filing receipt file lives exactly `RECEIPT_RETENTION_DAYS` and
no other copy of it is kept.

## Cost of change / cost of not changing

**If wrong:** one constant and the strings that quote it. A file already deleted cannot come back,
which is why the error is corrected towards longer, not shorter.

**If not done:** in year three an inspector asks for proof of a filing, the property has a hash and
no file, and the fine lands on the property. It would be discovered at the inspection, too late.

## Alternatives rejected

- **Keep two years until counsel answers.** The first manual receipts would already be on the short
  clock by the time the answer came.
- **Keep the files forever.** They may show names; nobody requires more than five years.
- **Move the filing payload to five years too.** It duplicates the names without adding proof.

## Consequences

- Up to five years of receipt PDFs per property in the private `compliance-receipts` bucket: small
  files, a handful a day at most.
- The data map, the privacy and compliance runbooks and the desk's two strings say five years.
