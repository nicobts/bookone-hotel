# Design note — in-stay messaging (`/[locale]/stay/[token]` · console conversations)

**Surface:** the guest's message thread and the staff side of it, Sprint 7
(04 §1 Phase C).
**Stories:** E3.2, E3.3 (P0). E3.4 (P1) rides the same thread as request intake.
**Reference (08 §3, ADR-014):** **08 §3 names no reference for this surface.**
This note proposes two and argues the deviation from each; the table in 08 §3
needs the row, which is a documentation change this sprint makes.
**Proposed reference:** hotel guest-messaging products (Duve, HiJiffy) for the
guest-side thread and escalation model; the support-inbox pattern (Intercom's
public product documentation) for the staff side — assignment, takeover, and
the open/snoozed/closed lifecycle.
**Adopted:** thread-per-stay model, AI-first-then-human escalation ladder,
staff takeover semantics, canned-answer sourcing from a knowledge base.

Studied from public product pages, published documentation and demo videos
only. No trial accounts, no code, no copied wording.

---

## 1. Understand — what the references do, and why it works

**Guest side.** The category has converged on a single thread per stay, reached
without an account, that outlives any one channel: the guest writes from
WhatsApp, from a web link, from an SMS reply, and it is one conversation. An AI
answers first from a property-specific knowledge base; a human takes over when
it cannot. The guest is never told which is which mid-sentence — the thread is
continuous, and the handover is invisible to them except that answers get
better.

**Staff side.** The support-inbox pattern is thirty years old and stable for
good reason:

- **A queue, not a chat client.** Threads are work items with a state, not
  windows. Open, waiting, closed.
- **Context above the composer.** Who this is, what they bought, what happened
  so far — visible without leaving the thread.
- **Explicit ownership.** A thread is assigned or it is nobody's, and "nobody's"
  is a state the inbox shows loudly, because unowned work is how support
  organisations fail.
- **Takeover is one action and reversible.** A human enters; the automation
  stops; the human can hand it back.

**Why the AI-first ladder works commercially:** the volume is dominated by
questions with one correct, property-specific answer — wifi password, breakfast
hours, parking, late arrival, how the key works. These are not *conversations*.
They are lookups that arrive in prose.

## 2. Validate for our buyer

**There is no support team. There is one person, and they are also making
breakfast.** The reference products assume a desk with someone at it. Our
buyer's escalation target is a phone in an apron pocket, and the person holding
it is legitimately unavailable for four-hour stretches. This changes the design
in two places: the SLA alert has to exist (E3.2), and the guest must never be
left believing a human is about to answer when nobody is on shift.

**The knowledge base does not exist yet and nobody will write one.** The
reference products ship an empty KB and a form. A ten-room property will not
fill it in. This is why AG-03 (06 §2) ingests the property's own website into a
draft KB — but that is Sprint 9. For Sprint 7 the KB is a table with a small
seeded set, and the honest consequence is that the concierge escalates more than
it answers. That is the correct failure direction.

**Four languages, and the guest's is not the property's.** The reference
products translate. We do not generate a translated fact: a KB answer exists per
locale or it does not exist, and a missing locale escalates rather than being
machine-translated into a claim about a property's breakfast hours that nobody
at the property has ever read.

**Nothing the guest reads may be invented.** This is binding rule 7, and it is
the hard constraint that shapes the whole surface. In a support product a
slightly-wrong AI answer is embarrassing. Here, a made-up checkout time or
parking instruction is the product telling a guest something about a business
that the business never said — and the property, not us, is the one the guest
argues with at the desk.

## 3. Re-derive — the surface we build

**One thread per stay** (`message_threads`, keyed by reservation), reached from
the stay token. Messages carry an author kind: `guest`, `agent`, `staff`,
`system`.

**The answer ladder, in order:**

| Step | What happens | State |
|---|---|---|
| 1 | Guest sends a message | thread `open`, `awaiting_reply` |
| 2 | AG-01 runs: matches intent, calls typed tools, gets `phrase` fields back | run recorded in `agent_runs` |
| 3a | Every fact it needs came from a tool → it replies | `answered` |
| 3b | Anything is missing, uncertain, or money/dates/complaint → it escalates | `escalated`, unassigned |
| 4 | Staff opens the thread, sees the stay card and a summary, takes over | `escalated`, assigned |
| 5 | Staff replies; may hand back | `answered` / `open` |
| 6 | Nobody replied within the property's SLA | alert to the exceptions inbox |

**The console side** is a list of threads that need a person, ordered by how
long they have waited, with the stay card (who, which room, which dates, journey
state) above the composer, and a one-tap **Take over** / **Hand back**.

## 4. Deviations, each tied to the wedge

**(A) The model never states a fact. Tools do.** Every tool returns a
pre-formed `phrase` (ADR-009, and the shape is already fixed by the Concierge
PRD §9 tool contracts). The model's job is to pick a tool and choose among
phrases — not to compose a sentence containing a number. The tool-boundary
audit job (E3.2 AC) checks this after the fact by re-reading agent replies
against the tool outputs of the same run: a reply containing a price, a date, a
time or a room name that appears in no tool output is a violation, and the
violation count must be zero. This is the AC that makes rule 7 measurable rather
than aspirational.

**(B) Escalation is the default, not the failure.** The references tune for
deflection rate because deflection is their pricing metric. Ours is
`bookone_resolved` at ≥55% (06 §2), which is lower than the category claims on
purpose. An agent that answers 90% by guessing at the last 35% costs the
property more than it saves. When in doubt it escalates, and the eval set scores
a confident wrong answer far worse than an escalation.

**(C) The guest is told, once, that they are talking to software.** Not
disclaimed on every message — that is noise, and the references are right to
avoid it. Once, at the top of the thread, in the guest's language. This is an
EU AI Act transparency obligation for interaction with an AI system, and it is
also just how you avoid a guest feeling deceived when the handover happens.

**(D) "Nobody is on shift" is a state the guest can see.** Where the references
show a typing indicator and a vague "we'll be right with you", we show the
property's actual response expectation. A guest who knows the answer comes at
07:00 does not send four more messages at 23:40, and does not walk to a desk
that is closed.

**(E) No staff assignment model beyond take-over.** The reference inbox has
teams, routing rules, round-robin and skill matching. Our property has one to
three people. A thread is escalated (nobody's) or taken (someone's). Anything
more is configuration a ten-room hotel will never set up, and unconfigured
routing rules route to nowhere.

**(F) The thread is not a channel abstraction yet.** The references' strength is
being channel-agnostic on day one. WhatsApp needs a verified BSP (04 §0), which
is not done. So the thread is stored channel-agnostically and rendered on the
stay page; the `notifications` outbox already carries the channel enum, and
adding WhatsApp is a provider, not a re-model. What we do *not* do is pretend
WhatsApp works.

**(G) Requests become tasks, and the task is visible to the guest.** E3.4 is P1,
but `create_task` is in AG-01's tool grant (06 §2) because the alternative is an
agent that says "I'll let them know" into a void. A request creates a row
someone can close; the guest sees that it was recorded, not that it was done.

## 5. Deliberately deferred

- **WhatsApp and SMS delivery** — blocked on BSP verification (04 §0).
- **Voice** — WS-B owns it; this sprint shares the tool contracts, not the
  transport.
- **KB authoring UI** — E5.3, Sprint 9. Seeded rows and a runbook until then.
- **Upsell offers** — in AG-01's remit (06 §2) but they touch money, which is
  T2, which needs the proposal/diff-card surface that Sprint 8 builds.
- **Sentiment and CSAT** — measurable later; nothing depends on it now.

## 6. How we will know it worked

- Tool-boundary audit: **zero** violations. This gates the sprint.
- Share of threads closed without a human, per property, from `agent_runs` and
  thread state — reported, not yet targeted, because the KB is thin.
- Time from `escalated` to first staff message, which is what the SLA alert is
  computed from and what an owner will actually feel.
