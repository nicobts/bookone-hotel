# ADR-022 — The model selects; tools author every guest-facing sentence

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-009 (hard tool boundaries), ADR-021 (orchestrator and profiles) · **Supersedes:** nothing
**Origin:** WP0.1 inventory `docs/11-inventory.md` §3 item 4 — a conflict between the Guest Desk handoff (WP0.2) and binding rule 7

## Triggering event

The Guest Desk handoff has the model produce guest replies (`generateText` per profile, WP0.2).
Binding rule 7 says facts come from tools only, tools return pre-formed `phrase` fields, and AG-01
today relays the phrase verbatim. The nightly tool-boundary audit
(`packages/core/src/concierge/audit.ts`) flags any reply that does not appear in its own run's tool
output, and the gate is zero. A generated reply fails that audit by construction.

## Context

The choice was between:

1. **The model writes the reply**, and the audit is relaxed to "every fact and number in it appears
   in a tool output".
2. **The model selects**: it classifies intent, picks the profile and the tool, and extracts the
   arguments. The sentence the guest reads is still the tool's `phrase`.

Option 1 widens what the product can say and makes the audit a fuzzy match; a paraphrased price
("around eighty") is exactly what a number check misses. Option 2 keeps the audit exact and puts the
model where it adds recall — understanding what was asked in four languages — without giving it
authorship.

## Decision

**The model never authors a guest-facing sentence.** In the orchestrator (ADR-021) a model may:

- classify intent and choose a profile;
- choose a tool from the profile's allow-list and fill its arguments;
- decide between tools when more than one could apply.

What the guest reads is a tool's `phrase`, verbatim, or a fixed template owned by the profile (for
example the approval-pending message), which is itself sourced text. Tools compose their phrases
from rows, in the guest's locale, as they do today.

The tool-boundary audit is unchanged: reply ∈ tool output of its own run, every number in the reply
∈ tool output, gate zero.

## Cost of change / cost of not changing

**If wrong:** moving to model-written replies later means relaxing one audit rule and adding a
generation step after tool selection, which this design leaves room for. It should be done with an
eval set that measures fabrication, not on the strength of a demo.

**If not done:** the first guest-facing model sentence either fails the nightly audit — so the audit
gets relaxed under deadline — or passes a relaxed audit that cannot see a paraphrased price. In this
product a wrong rate or date said to a guest is a commercial liability (ADR-009), not a bug.

## Alternatives rejected

- **Model writes, facts checked.** Rejected above: a fuzzy audit is weaker than an exact one, and
  the gain in fluency is not what the Phase 0 demo is sold on.
- **No model at all.** AG-01's deterministic intent classifier escalates more than it answers. A
  model widens recall without widening authorship — the direction IMPLEMENTATION-STATUS already
  records for ADR-012.

## Consequences

- Replies read as consistent product copy rather than chat. Tools need good phrases in four
  languages; a missing language escalates, as the knowledge editor already shows.
- The demo can run with the model part disconnected (deterministic routing) and with it connected,
  with identical guest-facing text — which makes a provider swap measurable.
- Any future proposal to let the model write must supersede this record.
