# ADR-029 — Stored data stays in the EU; model and vision processing may run outside it

**Status:** Accepted · **Date:** 2026-09-27
**Depends on:** ADR-006 (Supabase EU), ADR-012 (LLM provider abstraction), ADR-023 (AI SDK behind LlmProvider) · **Supersedes:** nothing
**Amends:** D9 (docs/00-PROJECT-OVERVIEW.md) and ADR-012's EU-processing requirement. Storage residency is unchanged; the requirement for model processing becomes a reassessment at production.

## Triggering event

WP0.1 found that no LLM or vision provider passes D9 registration. That blocks three things:

- the model half of the orchestrator (ADR-023);
- OCR in pre-arrival capture (WP0.4);
- therefore the Phase 0 demo.

D9 had been read as "nothing leaves the EU, ever". That reading bundles two different things:

- **where the data lives**: databases, file storage, backups, logs;
- **where a request is processed**: a model API call.

## Context

**What GDPR requires.** GDPR does not require processing to stay in the EU. Sending personal data to a
processor outside the EU is an **international transfer** (Chapter V). It is lawful with a transfer
mechanism — an adequacy decision such as the EU-US Data Privacy Framework for certified recipients, or
Standard Contractual Clauses in the processor's DPA. The transfer must also be disclosed to data
subjects.

**Why EU-only processing was chosen.** It is a product and positioning choice, not a legal minimum.

**What OpenRouter offers.** OpenRouter is one API in front of most model vendors and is reachable from
the AI SDK:

- Standard accounts route globally.
- Business/Enterprise accounts can use in-region EU routing (`eu.openrouter.ai`).

Both use the same API, so moving from one to the other is a change of base URL, not of code.

## Decision

**Data residency stays EU-only (D9 unchanged for storage).**
- Every system that *stores* platform data is EU-resident: Postgres, file storage (including
  identity-document images), backups, logs, traces and job state.
- Model providers are called with **zero data retention** and **no data collection for training**
  wherever the API offers it, so a request leaves nothing stored outside the EU.

**Model and vision processing may run outside the EU**, for development, testing, the demo and early
production. Conditions:
- **OpenRouter is the initial gateway** for the `small` and `strong` tiers (ADR-023) and for document
  vision/OCR (WP0.4), registered through `LlmProvider`. The endpoint is configuration.
- **A transfer mechanism is in place and recorded.** OpenRouter's DPA or SCCs, and the underlying
  providers' mechanisms, are recorded in the sub-processor register entry. That entry states that
  processing is non-EU.
- **The registry keeps its checks.** It accepts a non-EU provider only when the provider cites this
  ADR and a register entry exists.
- **The transfer is disclosed.** Guest privacy notices and the DPA template say that automated
  processing may occur outside the EU, under which safeguards.

**Reassessment.** At production launch with paying properties, and again once there is real traction,
the question is decided on evidence: must model processing be EU-only? The evidence is what customers
and associations ask for, what the transfer assessment says, and cost. Moving is configuration: OpenRouter
EU routing, or a provider that passes ADR-012 unchanged. The outcome is a new ADR superseding this one.

## Cost of change / cost of not changing

**If wrong:** switching the endpoint or provider is configuration plus a register update. Nothing in
code names OpenRouter outside the provider registration.

**If not done:**
- The demo runs without a model and without OCR — a deterministic router the association would read as
  "a chatbot" (plan §10 risk).
- Alternatively, an EU enterprise contract is signed before anyone has agreed to pilot.
- The stricter rule would also have been kept for a legal reason that does not exist.

## Alternatives rejected

- **EU-only processing from day one.** A positioning choice presented as a legal requirement. It blocks
  the demo on procurement.
- **Drop D9 entirely.** Storage residency is cheap to keep, already built, and central to what the
  product promises about data ownership.
- **Call vendor APIs directly.** Same transfer position, with a separate integration and DPA per vendor,
  and no one-line path to EU routing.

## Consequences

- **"EU-hosted" stays true. "EU-processed" does not.** Sales and collateral must say exactly that. The
  one-pager (WP0.7) claims EU hosting, not EU-only processing.
- **Identity-document images are the most sensitive payload.** Sending a real guest's document to a
  non-EU OCR endpoint should be covered explicitly by the transfer assessment before the first real
  property enables pre-arrival OCR. Until then, the demo uses fixture or volunteer documents.
- **The integration code is dependency work.** Adding `ai` and the OpenRouter provider package
  (`@openrouter/ai-sdk-provider` or `@ai-sdk/openai-compatible`) still needs sign-off at the time.
- **The ESP (email) is not covered by this record.** It stores message content, so D9 applies to it
  unchanged.
