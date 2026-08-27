# 05 — Architecture Decision Records

**This file has moved to [`docs/adr/`](adr/README.md) — one file per record.**

Format: Context → Decision → Consequences. Status: `accepted` unless noted.
Superseding an ADR requires a new ADR referencing the old one — never edit
history.

ADR-001 through ADR-015 are unchanged from documentation handoff v1; they were
split out of this file verbatim, with only a status line added. Numbering is
preserved, so every existing citation of "ADR-011" still means what it did.

The split happened because a single file stops working at the point where the
index matters more than the prose — you cannot link to one decision, cannot see
at a glance which are built, and every new record makes the file harder to read
rather than the set easier to navigate.

| | |
|---|---|
| **Index and rules** | [`docs/adr/README.md`](adr/README.md) |
| New record | copy [`docs/adr/TEMPLATE.md`](adr/TEMPLATE.md) |
| Decided vs shipped | [`docs/adr/IMPLEMENTATION-STATUS.md`](adr/IMPLEMENTATION-STATUS.md) |

**ADRs override anything conflicting elsewhere.** Precedence is unchanged:
ADRs > docs/00–08 > annexes/business.
