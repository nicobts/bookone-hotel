# WP0.2 — Profile router and profile contracts over AG-01
Depends on: WP0.1 · Est.: 5–7 days

## Goal
Replace AG-01's monolithic behaviour with the orchestrator of ADR-F1: hard rules → intent routing → profile
execution via AI SDK, tools via MCP allow-list, every action audited.

## Build
- `src/agent/profiles/schema.ts` (provided) + loader that validates every `*.json` at boot and fails fast.
- `src/agent/router/hard-rules.ts`: deterministic pre-checks (money/compensation, identity/legal, emergency, off-topic/abuse, unknown-twice). Keyword + small-model classifier; output is a tier decision, never text.
- `src/agent/router/route.ts`: small-model intent classification → profile id; sticky profile per thread with switch on clear intent change; unknown → `general-info` first, `T2` second time.
- `src/agent/run.ts`: AI SDK `generateText`/`streamText` with `maxSteps` from the profile, tools = MCP tools filtered by the profile allow-list, `needsApproval` for `approvalRequired`.
- `src/mcp/`: MCP server skeleton with tool registry; tools in this WP are stubs returning seeded data (real actions come in WP0.3).
- `AgentAction` table + writer middleware around every tool call (profile, tool, input, output, reversible, reversed_by, thread_id, tenant_id).
- Model provider config: `models.ts` with `small` and `strong` entries, EU endpoints, provider swappable by env.

## Touches
`src/agent/**`, `src/mcp/**`, `AgentAction` schema, `models.ts`, AG-01 entry point.
## Must not touch
Channel adapters, inbox UI, payments, pre-arrival capture.

## Acceptance criteria
- [ ] All 8 profile files load and validate; a malformed profile fails boot with a clear error.
- [ ] A profile cannot call a tool it does not list (test: tool call attempt is rejected and logged).
- [ ] Hard rules fire before routing: "voglio un rimborso" never reaches T1 regardless of profile (test).
- [ ] Every tool call produces exactly one `AgentAction` row (test).
- [ ] Switching provider via env changes nothing else (test with a mock provider).
- [ ] IT and EN routing on the eval set ≥ 90% correct profile.
## Tests
Unit: hard rules, allow-list, loader. Evals: ≥ 5 conversations per profile under `evals/wp0.2/`.
## Stop and ask
Any change to the hard-rule list. Adding a dependency beyond `ai`, provider packages, `@modelcontextprotocol/sdk`, `zod`.
