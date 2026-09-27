# Design note — the agents page and agent preview (`/[locale]/[property]/console/agents`)

**Surface:** a console page listing the property's agents, what each may do and
whether it runs here, with a side panel to try the concierge. Also covers the
owner's assistant page moving onto the shared chat.
**Decision:** ADR-038 (preview without side effects), ADR-037 (shared chat
interface).
**Reference (08 §3, ADR-014):** 08 §3 names no reference for this surface. This
note proposes one and argues the deviations; the row is added to 08 §3 in the
same change.
**Proposed reference:** the "AI agent" settings and test panels of
customer-service platforms: Intercom's Fin, Zendesk's AI agents, and in
hospitality, HiJiffy.
**Adopted:**
- a single place that says what the assistant is allowed to do;
- a test panel beside it that answers from the real knowledge but reaches no
  customer;
- per-answer disclosure of which source or behaviour produced it.

Studied from public product pages, published help-centre articles and demo
videos only. No trial accounts, no code, no copied wording.

---

## 1. Understand — what the references do, and why it works

Across the category, an owner of an AI agent gets three things:

- **A statement of scope.** What the agent handles, which topics it hands to a
  human, which actions it may take. It is readable by the person accountable
  for the agent, not only by whoever configured it.
- **A safe place to try it.** A preview answers as a customer would be
  answered, from the same content, without the conversation reaching a
  customer or appearing in the support queue.
- **Why this answer.** Each test answer shows its source (the article used, or
  "handed to a human") so a wrong answer can be traced to content, which is
  something the owner can fix.

It works because the owner's real question is not "is the AI good" but "what
will it say to *my* guest, and what will it *do*". Only a preview over their
own content, with the reasoning shown, answers that.

## 2. Validate for our buyer

A small independent hotel owner (D2) is accountable for what the concierge
tells guests, and has heard enough about AI to distrust it. Seeing the scope
and trying it before a guest does is the difference between switching it on
and not. Staff need it too: a receptionist who has tried "Can we check out at
1 pm?" knows the approval will land in their console.

## 3. Re-derive — what we changed and why

- **Scope as facts, not copy.** The references describe scope in prose the
  vendor writes. Ours is generated from the agents' actual definitions, and a
  test fails if the page drifts from what the agent can do (ADR-038 §5).
  - **Profiles:** what it handles.
  - **Tools**, each classed as *reads*, *acts* or *needs your approval*.
  - **Hard rules:** code, not instructions.
- **Actions are simulated, visibly.** The references' test panels mostly run
  pure Q&A. Our concierge acts: it files requests, logs complaints and asks
  for approvals. In preview every non-read action is simulated. The reply
  says what would have happened and that nothing was done; the badge reads
  "would do, not done". A preview that quietly did things would be worse than
  none.
- **Speak as a real stay.** A tester may pick one of the property's current
  stays, so booking questions read real facts, which is what makes a checkout
  preview meaningful. Nothing reaches that guest (ADR-038 §4).
- **The owner's assistant is the real thing.** It only reads, so it has no
  preview. Its page uses the same chat component, so the product has one
  chat, not three.
- **Background agents are listed, not chatted to.** Reconciliation, the fee
  auditor and knowledge drafts show what they do and when they last ran. A
  chat box on an agent that does not converse would be a pretend feature.
- **Staff see it.** The references put the agent in admin settings. We put it
  in the operating band, because testing and understanding the concierge is
  part of running the house, not of configuring it.
