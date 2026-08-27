# ADR-013 — Guest journey is an evented state machine and the single source of stay truth

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Journey spans booking→departure across modules, channels, and (later) IoT triggers; scattered status flags rot.

**Decision.** `journey_states` transitions only via evented commands; all modules (voice, IoT, console, agents) are trigger sources into the same machine; Realtime projects state to the console.

**Consequences.** (+) New trigger sources (door events, agents) plug in without journey changes; zero-touch metric (G1) computable directly from events. (−) Discipline: no module may write journey state directly.
