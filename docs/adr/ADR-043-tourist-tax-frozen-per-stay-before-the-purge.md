# ADR-043 — Each stay's tourist tax is computed and frozen before its registration records are purged

**Status:** Accepted (owner, 2026-09-30); built with the first real comune · **Date:** 2026-09-30
**Depends on:** ADR-020, ADR-042 · **Supersedes:** nothing

## Triggering event

WP1.4 computes the tax from registration records at declaration time. Those records, birth dates
included, are purged 30 days after departure, and the comune's declaration is periodic, with the
annual one due by **30 June of the following year** (DL 34/2020 art. 180). A declaration computed
after the purge would charge every child and teenager as an adult. `docs/runbooks/compliance.md`
recorded the conflict and left the choice open.

## Context

Two ways out were on the table:

- **(a) Keep registration records until the declaration is filed**, about eighteen months: every
  guest's identity data, held a year and a half to count children.
- **(b) Compute each stay's tax while its records exist and keep only the result:** counts and
  amounts, no names, no birth dates.

## Decision

**(b).** For each stay, at checkout, BookOne computes the tax with the engine and stores a frozen
per-stay record holding:

- nights, taxable guests, guests exempt by code, guests by age band;
- the amount, the rules version used, and when it was computed.

It holds no name, birth date or document.

- Corrections are allowed until the stay's registration records are purged: the record is
  recomputed. After the purge it is fixed; a later adjustment is a new, signed entry, never an edit.
- The purge refuses to delete a stay's registration records while its tax record is missing, for a
  property whose tourist-tax feature is on. The desk sees why.
- The declaration, the reconciliation with the hotel's books and the inspection export all read
  these records. They are the tax ledger.
- The records are kept five years (L. 296/2006, art. 1 c. 161), as tax documentation.

A change complies if nothing computes a tax amount for a period from registration records once
those records can have been purged.

**Not built yet.** WP1.4 runs on fictional comuni. The table, its migration and RLS arrive with the
first real comune, before its rules file goes live.

## Cost of change / cost of not changing

**If wrong:** the frozen records are derived data. They can be recomputed while the source exists,
and a different design can replace them for future stays.

**If not done:** the first real declaration either overcharges every family, or the purge is quietly
switched off and identity data piles up for eighteen months. The first would be found by the hotel's
accountant; the second perhaps never.

## Alternatives rejected

- **(a) Longer retention of registration records.** It multiplies what a breach exposes, against
  data minimisation, to answer a counting question.
- **Keep only birth years past the purge.** Still personal data tied to a stay, and age bands at the
  arrival date are all the engine needs.

## Consequences

- One new table, property-scoped with RLS, in the data map with a five-year retention.
- The declaration becomes a sum over stored records, not a recomputation, which also makes
  "reconciles to the cent" (the WP1.4 gate) easier to check.
