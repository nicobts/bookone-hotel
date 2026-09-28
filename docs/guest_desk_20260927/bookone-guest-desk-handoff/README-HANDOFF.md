# BookOne Guest Desk — handoff package

This package forks the existing BookOne handoff (Docs 00–09) into the **Guest Desk** scope:
guest communication agent + pre-arrival capture now, statutory compliance core next.
Nothing from Docs 00–09 is deleted; modules not in scope are placed behind per-tenant feature flags.

## Drop-in layout

```
CLAUDE.md.addendum.md        → append to the repo's CLAUDE.md
docs/10-guest-desk-plan.md   → the phased plan (source of truth for scope and gates)
docs/adr/ADR-F1..F9.md       → new architecture decisions (same format as existing ADRs)
docs/specs/WP0.x.md, WP1.x.md→ one spec per work package; one WP = one Claude Code session = one PR
src/agent/profiles/          → profile contract schema + the Phase 0 profiles as data
evals/README.md              → where every WP drops its replayable conversations
```

## The loop

1. **Session 0 is read-only.** Run `docs/specs/WP0.1.md` first. It produces `docs/11-inventory.md`
   (exists / partial / missing per flag-matrix row). Read it. Re-baseline WP estimates. Only then build.
2. **One WP per session, in dependency order.** Prompt: "Read CLAUDE.md, docs/10-guest-desk-plan.md §4,
   docs/11-inventory.md and docs/specs/WP0.2.md. Plan, then implement WP0.2 only. Add the tests and the
   eval conversations the spec requires. Open a PR. Do not touch anything outside the spec's 'Touches' list."
3. **Review the PR, not the chat.** Router hard rules and money/identity gates are read line by line.
4. **Stop-and-ask list** (in CLAUDE.md addendum) is enforced: Claude Code halts and asks on those.
5. Phase 1 starts only when the §4 acceptance checklist is green and the association gate is passed.
