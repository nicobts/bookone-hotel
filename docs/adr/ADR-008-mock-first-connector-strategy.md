# ADR-008 — Mock-first connector strategy

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Ericsoft API approval takes 2–5 months and is outside our control; exception paths are the hardest code and need failure conditions to exist.

**Decision.** `MockEricsoftAdapter` with deterministic fixtures and failure injection ships in Sprint 2. The real adapter must pass the mock's contract-test suite before swap. Beta may go live on mock + manual re-entry (parity with the hotel's current manual reality).

**Consequences.** (+) External calendar decoupled from build calendar; exception UX built early. (−) Contract tests must be maintained as the real API teaches us its quirks.
