# WP1.4 — Imposta di soggiorno rule engine, Trieste rule table, declaration export
Depends on: WP1.1 · Est.: 1.5 weeks · Blocked on: Comune di Trieste regolamento and declaration format

## Build
- Rule engine: per-person-per-night rate by category/season, max nights, exemptions (age, reason codes), rounding; rules as data (`rules/trieste.json`) with effective dates.
- Collection: amount computed per booking, collected via the payments profile or at checkout; exemption evidence captured.
- Declaration export in the comune's format for the period; reconciliation to the cent with collected amounts.

## Acceptance criteria
- [ ] Golden tests for 20 booking scenarios (children, long stays, mixed exemptions).
- [ ] One full period reconciles to the cent with a pilot's own books.
- [ ] Adding a second comune requires only a new rules file (test with a fictional comune).
