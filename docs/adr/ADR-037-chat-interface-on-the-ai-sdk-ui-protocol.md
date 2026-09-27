# ADR-037 — A shared chat interface on the AI SDK UI protocol, first as an agent preview

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-021 (orchestrator), ADR-022 (the model selects, tools speak), ADR-023 (AI SDK behind `LlmProvider`), ADR-031 (operator console) · **Supersedes:** nothing
**Amends:** ADR-023's import rule. `@ai-sdk/react` and the UI-stream helpers of `ai` are allowed in the chat interface and its endpoints. Model access still goes only through `LlmProvider` in `@bookone/core/llm`.

## Triggering event

The owner wants to talk to the agents directly, to preview and test them. That
means the concierge (AG-01) as a guest would, and the owner assistant (AG-06).
They also want the same chat to be embeddable later on a hotel's website or
another platform. They named shadcn's `chatbot-template` (MIT) as the basis.

## Context

The template streams a general-purpose model's reply straight to the browser.
Our agents don't work that way:

- The orchestrator routes, a profile picks a tool, and what is said is the
  tool's phrase (ADR-022, binding rule 7).
- A turn is recorded in `agent_runs`, and actions may be held for approval.

A chat UI that called a model directly would bypass every one of those rules.

## Decision

1. **The interface is the template's chat, in `packages/ui`**
   (`@bookone/ui/components/chat/*`), built on our radix-based primitives, so
   the operator console, the hotel console and a future embed share one
   component. Its message scroller comes from the same author (`@shadcn/react`).

2. **The wire protocol is the AI SDK's UI message stream** (`useChat` in the
   browser). It is a documented, versioned protocol. An embed on another site
   or platform speaks something standard instead of something we invented.

3. **The server side never calls a model.** A chat endpoint:
   - authenticates;
   - runs **our** turn: `previewGuestTurn` or `previewOwnerTurn` in
     `@bookone/agents/preview`, which is the same orchestrator, tools and
     recording as a real guest message;
   - streams back what the turn produced. That is the reply text as written to
     the thread, and a `data-run` part: profile, hard rule, tier, the tools
     with their status (done, held for approval, refused), route source,
     model, and run id.

   Rule 7 and the tool-boundary audit are untouched, because the text streamed
   is the text that was recorded.

4. **The preview runs only on demo properties** (`settings.demo = true`,
   set by `pnpm demo:seed`).
   - It writes real rows (the thread, tasks, complaints) because it is a real
     turn. On a real property, that would put an operator's words into a real
     guest's stay.
   - The operator picks which demo guest to be. The owner assistant answers as
     the property's first recorded owner number.

5. **First surface: "Agent playground" in `apps/admin`,** behind staff
   authentication (ADR-031). An embed for hotels' websites is a later step. It
   needs pre-sale threads without a reservation (a schema migration) and a
   public endpoint in `apps/api` with the rate limit. It reuses this component
   and this protocol unchanged.

## Cost of change / cost of not changing

**If wrong:** the protocol is a transport. Replacing it touches the chat
component and one endpoint; the agents do not change.

**If not done:** testing the agents means the stay page, one guest at a time,
with no view of which profile answered, which tool ran, or why a turn was
handed over.

## Alternatives rejected

- **Using the template as-is (streaming a model).** It violates ADR-022 and
  rule 7. What the preview would show is not what a guest gets.
- **A bespoke fetch-and-render chat.** Less to depend on, but a private
  protocol that the future embed would have to replace.
- **Previewing on any property with a "dry run" flag.** The tools write, and a
  dry-run path through every tool is a second implementation that drifts from
  the real one. Demo properties exist exactly for this.

## Consequences

- New dependencies, requested by the owner: `@ai-sdk/react` (pinned to the
  release paired with core's `ai`), `@shadcn/react`.
- The eslint rule banning the AI SDK outside `@bookone/core/llm` gets a scoped
  exception for the chat component and the chat endpoint, which cites this ADR.
