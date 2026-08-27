---
name: write-adr
description: Use when recording an architecture decision that would be expensive to reverse — in money, migration effort, liability, or trust. Also use when a task appears to require breaking a binding rule.
---

# Write an ADR

## When

A decision belongs in `docs/adr/` when reversing it later would be expensive.
Everything else is just code, and code is cheap to change.

**Also write one when a task seems to require violating a binding rule.** The
answer is a decision revision, never a workaround — `CLAUDE.md` says so
explicitly. Stop and surface it rather than coding around it.

## The sequence

1. **Check it is one decision.** If the title needs "and", it is two records.
2. **Take the next free number** from `docs/adr/README.md`. Three digits.
   **Never reuse or renumber** — roughly fifty references across the doc set and
   the codebase cite these numbers.
3. **Copy `docs/adr/TEMPLATE.md`.** Filename `ADR-0NN-kebab-title.md`.
4. **Name the triggering event.** What forced the decision now. A record without
   one is usually a preference looking for authority.
5. **State the counterfactual** — the `Cost of change / cost of not changing`
   section. What breaks if we don't, and how it would be discovered. This is
   what separates a decision from a preference; a record that cannot answer it
   is not describing a decision.
6. **Write down the alternatives you rejected**, with why. An alternative not
   written down gets re-proposed every few months.
7. **Add the row** to the index table in `docs/adr/README.md`.
8. **Add a row** to `IMPLEMENTATION-STATUS.md` — decided is not shipped.
9. **If it amends a canonical doc**, say so in the header (`Amends:`). ADRs
   override docs/00–08, but a reader of the older doc needs to be told.

## Immutability

An accepted record is never edited. New information supersedes it with a new
record that references the old one, and the old one gets
`Superseded by ADR-0NN`. The wrong turn is part of the history and is usually
the most useful part of it.
