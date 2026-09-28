# WP0.6 — Inbox: audit log, reversal, handoff reason, SLA timer
Depends on: WP0.3 · Est.: 3–5 days

## Build
- Thread view shows every `AgentAction` inline (tool, input summary, result, timestamp) with a "Annulla" button where `reversible` and a reversal handler exists.
- Handoff card: tier, the hard rule or escalation rule that fired (from profile JSON), transcript so far, one-tap "Prendo io" that silences the agent on that thread.
- SLA timer on complaint threads; breach alert to owner WhatsApp.
- Pending approvals list (from `needsApproval`) with approve/reject; rejection sends a profile-defined fallback message.
- Realtime via Supabase Realtime; owner mobile view usable on a phone.

## Acceptance criteria
- [ ] Handoff reaches the owner's phone within 60 s and the agent stops replying on that thread (test with a fake clock + sandbox).
- [ ] Reversing a `modify_booking` restores the prior state and writes a linked `AgentAction`.
- [ ] Approval rejection never leaves the guest without a reply.
## Stop and ask
Any change to the tier semantics.
