# ADR-023 — The agent runtime is the Vercel AI SDK behind LlmProvider, not an agent framework

**Status:** Accepted · Amended by [ADR-029](ADR-029-model-processing-may-leave-the-eu.md) (provider availability) · **Date:** 2026-09-27
**Depends on:** ADR-011 (agents as workers), ADR-012 (LLM provider abstraction), ADR-021, ADR-022 · **Supersedes:** nothing
**Origin:** Guest Desk handoff ADR-F9, amended: the AI SDK sits behind ADR-012's port, and tools stay in-process rather than behind an MCP server

## Triggering event

The orchestrator (ADR-021) needs model I/O with typed tool calls, a bounded multi-step loop and an
approval hook. Nothing in the repo does that today: `LlmProvider.complete()` exists with no provider
registered, every agent is `model: 'none'`, and eslint bans vendor SDKs outside `@bookone/core/llm`.
The handoff proposed the Vercel AI SDK used directly by the agent loop, plus an MCP server in
`src/mcp/` as the only tool surface.

## Context

Layers considered (handoff plan §9): model I/O, agent loop, policy, tools, state, observability,
channels. Frameworks evaluated in the handoff: Mastra, LangGraph.js, eve, Hermes Agent. ADR-012
requires every model call to pass a residency and sub-processor-register gate, and ADR-011 requires
agents to act only through typed domain tools with grants checked by the runner, scoped to one
property.

## Decision

- **Model I/O and the bounded loop use the Vercel AI SDK (`ai`), inside `@bookone/core/llm`.** The
  SDK is an implementation detail of `LlmProvider`: provider packages (`@ai-sdk/*`) are registered
  through the existing registry, so ADR-012's residency and register checks still decide what can
  run. The eslint restriction extends to `ai` and `@ai-sdk/*` everywhere outside `@bookone/core/llm`.
- **Two model tiers**, `small` (routing, classification) and `strong` (argument extraction for
  actions), set per profile. The provider is configuration; nothing outside the registry names one.
- **Tools stay in-process** in `packages/agents/src/tools/`, gaining a zod input schema each (which
  the SDK needs for tool calling). The runner's grant check and `ToolContext` property scoping are
  the only path to a tool.
- **No agent framework, no MCP server** in Phase 0–2.
- **Approval** for `approvalRequired` tools is the orchestrator's: the call is recorded as pending
  and executed only after a human approves (T2), whatever the SDK offers.

Adding `ai` and the chosen provider package is a dependency change and needs sign-off at the time.
No provider can be registered until one passes D9 (04 §0); until then the orchestrator routes
deterministically, and the design allows that.

## Cost of change / cost of not changing

**If wrong:** the SDK is confined to one package behind a port; replacing it touches
`@bookone/core/llm` only.

**If not done:** either a vendor SDK leaks into agent code — the thing ADR-012 exists to prevent —
or the loop, tool-call parsing and retries are hand-written for every provider.

## Alternatives rejected

- **AI SDK used directly by agents (handoff as written).** Bypasses ADR-012's gate; the lint rule
  would have to be weakened to allow it.
- **MCP server for tools.** Adds a dependency, a transport and a second registry, all in-process,
  for no Phase 0 consumer. The one real consumer is a separate voice service (Phase 4); the MCP
  surface belongs in that record, wrapping the same tools.
- **Mastra.** Workflows and memory not needed before Phase 1 (ADR-025 decides that).
- **LangGraph.js.** Its centre of gravity is Python.
- **eve.** Beta, and shaped as a personal assistant.
- **Hermes Agent.** Single-user, self-modifying skills, shell access: never in a guest path.

## Consequences

- One package owns every model call, its cost and its residency.
- Agent budgets (`dailyBudgetCents`) become enforceable at the same seam.
- Phoenix tracing (ADR-024) attaches at the same seam, after PII redaction.
