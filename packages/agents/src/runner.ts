// pg-boss consumer: load agent -> run -> record.
//
// Triggers are `domain_events` patterns or schedules, dispatched as `agent.run`
// jobs (e.g. documents.uploaded -> AG-02, discrepancy.created -> AG-05, nightly
// -> AG-07). The runner scopes context to a single property, enforces the
// registry's tool grants, applies the per-agent per-property daily cost budget
// with a breaker, and writes one `agent_runs` row per run.
//
// Sprint 2 (06-AI-AGENT-LAYER §5).
export {}
