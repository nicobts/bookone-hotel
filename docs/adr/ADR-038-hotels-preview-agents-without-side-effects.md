# ADR-038 — Hotels see and preview their agents in the console, without side effects

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-019 (entitlements), ADR-021/022 (orchestrator; tools speak), ADR-034 (api enqueues, worker runs), ADR-037 (shared chat, AI SDK UI protocol) · **Supersedes:** nothing
**Amends:** ADR-037 §4. The operator playground stays demo-only with real turns. Hotels get a **preview mode** that runs on their own property and writes nothing a guest or a report can see.

## Triggering event

The owner asked for two things. First, the console's owner assistant should use
the shared chat, for consistency across the platform. Second, the hotel console
should get a page where owners and staff see their agents: what each does, its
profiles, tools and rules, and whether it is running. Each agent should have a
button that opens the chat to test it.

## Context

The operator playground (ADR-037) runs real turns on demo properties. That
can't be reused for a hotel, because a real turn on a real property:

- writes to a guest's thread, which the guest then sees;
- logs complaints and alerts the owner's phone;
- files tasks and approvals that appear in the console;
- could, through booking tools, touch what D14 bills.

Testing a concierge must not do any of that. ADR-037 rejected a dry-run flag
for the playground because demo properties made one unnecessary. For a hotel
there is no demo property, so preview is the only honest option. The problem is
making it fail-closed.

Two findings shaped the decision:

- **Tools' `write` flag is incomplete.** `create_task` writes a stay task and was
  not flagged, so the flag cannot be the safety boundary.
- **`apps/web` runs on Vercel,** and agents run in the persistent worker
  (ADR-003's constraint, ADR-034). The console must not run agents itself.

## Decision

1. **Preview mode in the runner (`RunInput.preview`), fail-closed.**
   - A tool executes only if it is in `READ_ONLY_TOOLS`. Every other tool is
     **simulated**: it is not called, it is recorded with status `simulated`, and
     its phrase says what would have happened and that nothing was done.
   - Approval-held actions are recorded as `simulated`, never
     `pending_approval`, so no approval list ever shows them.
   - The preview run has no thread, so no message is written, no thread is
     escalated and no alert is sent.
   - A test forces every tool into exactly one class, read-only or not. A new
     tool that nobody classified fails CI rather than slipping into preview as
     "read-only".
   - `create_task` is now flagged as a write, which also fixes its idempotency
     (WP0.3).

2. **Preview runs are recorded.** They go into `agent_runs` with
   `output.preview = true` and `input_ref` set to the request id, plus a
   `domain_events` row `agent.previewed` naming the person who tested. "Who
   tested what" has an answer, and the runs stay auditable. Thread-keyed
   consumers never see them because they have no thread, and approvals don't
   see them because nothing is `pending_approval`.

3. **The console never runs an agent.**
   - Its chat endpoint (`apps/web/src/app/api/agents/chat`) authenticates the
     member and enqueues through `apps/api`.
   - The api sends `agent.preview` for the concierge, and the existing
     `owner.ask` for the owner assistant. The worker runs it and records
     `input_ref`.
   - The endpoint reads that run back under the member's own session (RLS on
     `agent_runs`) and streams it over the ADR-037 protocol.
   - A turn costs one queue hop, about 2–5 s. The model and its key stay in the
     worker.

4. **Who may do what (ADR-019, ADR-016).**
   - **Concierge preview:** any member, owner or staff, while the property has
     `concierge`. A concierge paused by an operator can still be previewed:
     nothing reaches a guest. The page shows the pause.
   - **Owner assistant:** the owner only. It is read-only and already live, so
     its chat is the real thing, not a preview. The console's "Assistente" page
     becomes this chat.
   - **Optional stay context:** a tester may pick a current stay, so booking
     tools read real facts. Reads are what a member can see anyway; writes stay
     simulated, and nothing reaches that guest.

5. **The agents page (`/console/agents`)** shows, from code rather than from
   copy:
   - each agent's purpose and whether it runs here (feature, operator pause);
   - the last seven days of activity;
   - for the concierge: its profiles, each profile's tools classed as reads,
     actions or actions that need approval, and the hard rules.

   The catalogue is `@bookone/agents/catalog`, pure data. A test fails if it
   drifts from the registry, the profiles or the tools. Strings are in all four
   locales. Background agents (reconciliation, attribution audit, onboarding
   drafts) are listed with their status but have no chat, because they don't
   converse.

## Cost of change / cost of not changing

**If wrong:** preview is one branch in `callTool` plus one flag. Removing it
removes the page's test button; the agents themselves don't change.

**If not done:** an owner can't see what their concierge is allowed to do or
try it before a guest does. A real-turn preview on a real property would put
test messages into guests' threads and complaints into the console.

## Alternatives rejected

- **Previewing real turns on the hotel's own data.** It has every side effect
  listed above.
- **Previewing against the demo property.** It is safe, but it answers from the
  demo's knowledge base, not the hotel's. "Does my concierge answer breakfast
  right?" is the question owners actually ask.
- **Trusting the `write` flag.** It already missed one writer. An allowlist
  fails closed.
- **Running the preview in the Vercel function.** It would put the model key
  and agent runtime on Vercel, against ADR-003/034.

## Consequences

- New worker job `agent.preview` (feature `concierge`), and a new api route
  `/jobs/agent-preview`. `owner.ask` gains a `requestId`.
- A new console surface with its design note (`docs/design-notes/agents.md`) and
  a row in `docs/08 §3`.
