# ADR-F9 — Phase 0 runtime: AI SDK + own router + MCP tools; no agent framework
Status: Accepted · Date: 2026-09-27 · Related: ADR-F1, ADR-F5

## Context
Layer model (plan §9b): 1 model I/O · 2 agent loop · 3 policy · 4 tools · 5 state/jobs/workflows ·
6 observability/evals · 7 channels. Frameworks evaluated: Mastra, LangGraph.js, eve (Vercel, beta), Hermes Agent
(Nous, single-user assistant), one-VM-per-hotel deployment.

## Decision
Layer 1–2: Vercel AI SDK (provider abstraction, typed tools, `needsApproval`, bounded multi-step loop).
Layer 3: own router and profile contracts (ADR-F1). Layer 4: MCP server in `src/mcp/`.
Layer 5: Supabase EU (RLS per tenant) for conversation and workflow state; pg-boss for jobs; no workflow engine
(ADR-F5). Layer 6: Arize Phoenix self-hosted in the EU. Layer 7: existing ChannelAdapters (webchat, email
forwarding, WhatsApp Cloud API direct).
Models: two EU-resident tiers (small for routing/T1, strong for actions); provider is configuration.
Deployment: one container set (app, worker, Phoenix) on one EU VM; Cloud Run when justified.
Rejected: Mastra (features not needed before Phase 1), LangGraph.js (Python gravity), eve (beta, assistant-shaped),
Hermes (single-user, self-modifying skills, shell access — internal back-office only), one VM per hotel (margin and
single-data-store thesis).

## Consequences
+ Least code and magic; every failure understandable by one developer; runtime swappable via three seams
  (MCP tools, profiles as data, state in Postgres).
− Long-running workflows in Phase 1 are hand-built until ADR-F5 says otherwise.
