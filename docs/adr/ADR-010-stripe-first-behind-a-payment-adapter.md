# ADR-010 — Stripe first, behind a PaymentAdapter

**Status:** Accepted · **Date:** July 2026 (documentation handoff v1)

**Context.** Italian providers (Nexi/Axerve) may be preferable commercially later; Stripe ships fastest with SCA, vaulting, Connect, SAQ-A scope.

**Decision.** Stripe Connect Standard per property; all payment logic behind `PaymentAdapter`; policy engine and folio-lite are provider-agnostic.

**Consequences.** (+) V1 velocity; clean swap path. (−) Stripe fees; provider swap will still require re-vaulting cards (known cost, documented for the commercialista discussion).
