# Guest Desk fork — rules (append to CLAUDE.md)

## Scope
- Active scope is `docs/10-guest-desk-plan.md`. Phase 0 = work packages WP0.1–WP0.7. Do not start a WP
  whose dependencies are not merged. Do not implement Phase 1+ items unless the spec says so.
- Every module is behind a per-tenant feature flag. Flag OFF means dark: no routes registered, no nav,
  no scheduled jobs, no agent tools registered. Never hide UI; remove it from the registration path.

## Runtime rules (ADR-F1, F2, F3, F9)
- Model I/O and the agent loop use the Vercel AI SDK only. No agent framework (no Mastra, LangGraph,
  eve, Hermes). No workflow engine in Phase 0; long-running state is a state column advanced by events.
- One orchestrator, many profiles. A profile = `{ id, systemPrompt, tools[], escalation, grounding }`
  loaded from `src/agent/profiles/*.json` and validated against `schema.ts`. Never inline a prompt.
- Tools are exposed only through the MCP server in `src/mcp/`. Profiles get an allow-listed subset.
  No tool is callable by a profile that does not list it.
- Hard rules live in the router, in code, never in prompts:
  - any action involving money, refunds, compensation → never T1; requires human approval
  - any statement about identity, legal status or compliance outcome → never T1
  - unknown intent twice in a thread → T2 with transcript
  - emergency/safety keywords → send emergency info, page human, stop replying
- Every tool call writes an `AgentAction` row (profile, tool, input, output, reversible, reversed_by).
- Model endpoints must be EU-resident (Vertex AI europe-west*, Bedrock eu-central-1, Mistral EU).
  Guest data, document images and transcripts never leave the EU. No provider hard-coded: the
  provider is configuration.

## Data rules
- Supabase EU, RLS per tenant on every table. Document images encrypted at rest with a retention rule.
- PII is redacted before anything reaches logs or Phoenix traces.
- No Alloggiati Web, ISTAT or comune submission in Phase 0. Pre-arrival capture ends at
  `staff_confirmed` with a schedina preview.

## Testing and evals
- Every WP adds unit tests for its logic and at least 5 replayable conversations under `evals/<wp>/`.
- The demo tenant is seeded by `scripts/seed-demo.ts`; it must be re-runnable from a clean database.

## Stop and ask before doing any of these
- Adding a dependency. Changing the router's hard rules. Any schema migration. Anything that sends
  money or touches Stripe live mode. Anything that stores or processes identity documents beyond the
  spec. Enabling a flag for a real (non-demo) tenant. Calling any external authority system.

## Legal hygiene
- Competitor behaviour may be referenced in design notes; competitor code, assets, UI copy and coined
  names are never used. Each surface gets a short design note as evidence of independent development.
