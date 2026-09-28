# ADR-020 — Statutory guest-registration reporting is not fiscal core

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-002 (fiscal core is gated) · **Supersedes:** nothing
**Amends:** docs/00-PROJECT-OVERVIEW.md non-goals (clarifies scope; D11 unchanged)
**Origin:** Guest Desk handoff ADR-F7 (second half)

## Triggering event

The Guest Desk plan moves Alloggiati Web, regional ISTAT reporting (WebTur FVG first) and the
imposta di soggiorno from deferred to Phase 1. Binding rule 6 forbids fiscal-core code "under any
framing", and 00-PROJECT-OVERVIEW adds "No Rung-6 work of any kind, including 'just preparing it'".
Without a written boundary, every Phase 1 PR would have to relitigate whether it is fiscal.

## Context

ADR-002, D11 and rule 6 name what is gated: **SDI, corrispettivi, night audit, invoice issuance** —
documents that carry fiscal liability for the property. The guest-registration obligations are a
different family:

- **Alloggiati Web** — a public-security declaration (TULPS art. 109). Already built behind a mock
  (Sprint 6).
- **ISTAT movimento clienti** — a statistical return, filed regionally.
- **Imposta di soggiorno** — a municipal tax the property collects as agent and declares to the
  comune. It is a tax, which is where the ambiguity sits.

`docs/07-COMPETITIVE-ANALYSIS.md` already classes the ISTAT and tourist-tax module as "statutory but
not fiscal-issuance — safely outside the Rung 6 gate", and `docs/01-PRD.md` lists it in the P1
backlog. That classification was never recorded as a decision.

## Decision

Guest-registration reporting — **Alloggiati Web, ISTAT/regional statistics, and the imposta di
soggiorno computation and declaration** — is outside ADR-002's gate and may be built, each behind
its own feature (ADR-019).

The boundary is drawn by what the output is, not by the word "tax":

- **Allowed:** computing who owes what under a comune's rule table; recording exemptions and their
  evidence; producing the declaration or export the comune requires; reconciling it.
- **Still gated by ADR-002:** anything that issues a fiscal document (fattura, ricevuta fiscale,
  scontrino/corrispettivo), anything transmitted to SDI or the Agenzia delle Entrate, night audit.
- **Not decided here:** whether the platform **collects** the imposta through its payment flow.
  `docs/design-notes/booking-flow.md` §D keeps the tax as a note outside the online total, and
  collection would put a tax amount into the `payments` ledger. That needs its own record in WP1.4,
  before any code.

The authority router's `NEVER_PLATFORM = ['fiscal']` is unchanged. If registration reporting needs
an authority domain, it is a new domain, never `fiscal`.

## Cost of change / cost of not changing

**If wrong:** Phase 1 code is behind flags and produces reports and exports; turning it off loses
no fiscal record because none was created.

**If not done:** either Phase 1 stalls on a rule nobody wrote to cover it, or it proceeds on an
unwritten reading of rule 6 — which is exactly how gated work starts "just preparing it".

## Alternatives rejected

- **Treat the imposta as fiscal and gate it with D11.** It would block the Phase 1 gate (a tassa
  period reconciled to the cent) for a municipal declaration that issues no fiscal document.
- **Leave it to each PR's judgement.** Rule 6 exists because judgement under deadline drifts.

## Consequences

- Rule 6 and ADR-002 stand word for word. This record narrows nothing they name.
- WP1.4 opens with the collection ADR above; WP1.2–1.3 need no further scoping record.
- `docs/contracts/alloggiati-responsibility.md` (still unreviewed by counsel) remains a Phase 1
  prerequisite for real filing.
