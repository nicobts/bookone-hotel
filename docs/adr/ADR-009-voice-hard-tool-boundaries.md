# ADR-009 — Voice: speech-to-speech with hard tool boundaries; EU residency as a pre-filter

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** S2S wins on multilingual/noise/cost; cascaded wins on pre-utterance control and per-component EU endpoints. Rate hallucination is a commercial liability, not a bug.

**Decision.** Provider-abstracted `VoiceRuntime`. Bake-off on real recordings evaluates only EU-deployable options. Facts come only from tools; tools return pre-formed `phrase`; post-call audit of price/availability mentions without tool calls is a monitored metric. Any production hallucination incident moves the transactional path to cascaded.

**Consequences.** (+) Best conversational quality without unbounded liability. (−) Discipline lives in prompt+audit rather than pipeline structure; the audit is therefore non-optional.
