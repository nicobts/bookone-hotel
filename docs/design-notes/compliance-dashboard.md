# Design note — the compliance dashboard (`/[locale]/[property]/console/compliance`)

**Surface:** the property's filings with the authorities, today and by period, and the screen where
a person records a filing made by hand. Guest Desk WP1.6.
**Reference (08 §3, ADR-014):** 08 §3 names no reference for this surface. This note proposes one,
and the table gains the row.
**Proposed reference:** the filing calendar of sales-tax compliance services (Avalara Returns,
TaxJar's filing view) for the "what is due, where, by when" half, and the evidence library of
audit-readiness tools (Vanta, Drata) for the "prove it" half. Studied from public product
documentation and marketing pages only; no code, assets, copy or coined names.
**Adopted:** status counts per jurisdiction, the due and overdue split, one row per filing with its
proof beside it, and an export per period that an auditor can read without the product.

---

## 1. Understand: what the references do, and why it works

A filing calendar answers one question before any other: *is anything late, or about to be?* The
pattern is consistent:

- **One line per jurisdiction, with counts by state.** Due, filed, accepted, rejected. The owner
  reads the counts first and opens a list only when a count is not zero.
- **Overdue is its own number, never folded into "due".** Late is a different conversation, often
  with a penalty.
- **Each filing carries its confirmation.** The authority's reference number sits on the row, not
  in a separate archive.

An evidence library adds the other half: *for a period an auditor names, show every control and
its proof, and say where proof is missing.* The export is the product's answer to a person who
does not trust the product.

## 2. Validate for our buyer

- **The owner is not a compliance officer.** They file three things (Questura, Regione, Comune)
  with one or two portals. Counts per authority fit on a phone; a calendar grid does not, and
  they do not plan filings weeks ahead. The deadlines are hours or a day away.
- **The receptionist files by hand when the channel is down.** The manual screen is theirs, so
  it is in the operating band, visible to staff, with the portal steps in the portal's language.
- **An inspection is a Questura officer or a comune auditor asking for a period.** They will not
  log in. The export is a file, in a format an Italian spreadsheet opens.

## 3. What we changed

- **No calendar view.** Deadlines are 24 hours (Alloggiati) or the next day (ISTAT); a month grid
  would be empty but for today. The list is soonest-first instead.
- **Unfiled obligations are in the export, with their state.** An evidence library lists what has
  proof; we list everything owed in the period, so a gap is visible to the inspector and to the
  owner before the inspector.
- **The uploaded receipt's hash is in the evidence.** The file may show guests' names, so it goes
  at two years like the filing payload. The hash keeps proving the filing afterwards.
- **No agent action here.** The owner assistant can list what is due or failed; it cannot record a
  filing. A compliance outcome is never T1 (hard rules).

## 4. Deviations tied to the wedge

The dashboard shows only the modules the property has (ADR-019), and it is not a metrics page
(D15): the empty state is the success state, as in the exceptions inbox.
