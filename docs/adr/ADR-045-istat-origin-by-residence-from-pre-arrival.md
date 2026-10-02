# ADR-045 — ISTAT counts guests by residence, which pre-arrival asks for

**Status:** Accepted (owner, 2026-09-30) · **Date:** 2026-09-30
**Depends on:** ADR-039 · **Supersedes:** nothing
**Amends:** the pre-arrival form (Sprint 6, `packages/core/src/journey/precheckin.ts`)

## Triggering event

WP1.3's daily ISTAT return (WebTur FVG) needs each guest's origin. ISTAT defines origin as
**residence**: the country for foreign residents, the province for Italian ones (ISTAT circular
45/1996, model C/59). Pre-arrival never asked for residence, so WP1.3 counts by citizenship when no
residence is recorded, and says how many.

## Context

- Citizenship is often wrong for this: a German citizen living in Trieste counts as "Germany"
  instead of "IT-TS"; a Brazilian living in Munich counts as "Brazil" instead of "Germany". The
  fallback is honest, since the count is disclosed, but the figures a hotel files daily are wrong.
- The engine already reads `residenceCountry` and `residenceProvince` from the registration record
  (`compliance/istat.ts`, `compliance/webtur.ts`). Only the capture is missing.
- The statistical return is a legal obligation (Art. 6(1)(c)), so asking for residence is lawful
  and proportionate.

## Decision

- **Pre-arrival asks each guest for their country of residence**, and for the province when the
  country is Italy. Like every field but the name, it is not enforced on save: a half-filled form
  is kept (Sprint 6's rule). It is stored on the registration record next to citizenship, under the
  keys the return already reads, and purged with it after 30 days. Anything that is not a
  two-letter code is dropped rather than stored, so the return falls back openly instead of
  counting a guess (`journey/residence.ts`).
- The daily return is computed from the records while they exist (it is due the following day), so
  the purge does not affect it.
- **The citizenship fallback stays** for guests who skip pre-arrival or are added at the desk, and
  each day keeps counting how many were counted by citizenship. That number should fall towards zero.
- Residence is not sent to Alloggiati: the police record has no residence field.

A change complies if the ISTAT origin is residence whenever a residence is recorded, and the count
of citizenship-based guests is always reported.

## Cost of change / cost of not changing

**If wrong:** one field on a form and two keys in a JSON column. Removing them is cheap.

**If not done:** every daily return a pilot files is wrong for every guest living outside their
country of citizenship, and the regional office has no way to tell.

## Alternatives rejected

- **Keep counting by citizenship.** Accurate to the definition only by luck.
- **Ask the desk to type residence at check-in.** It moves typing to staff at the busiest moment,
  against the product's premise that the guest operates the hotel.
- **Ask only the lead guest and assume the party shares it.** Families usually do; groups often do
  not. One more field per guest is cheaper than a wrong count.

## Consequences

- Two more inputs per guest in pre-arrival, in four languages.
- The data export includes residence with the rest of the registration record; the data map is
  unchanged, since the record's categories already cover it.
