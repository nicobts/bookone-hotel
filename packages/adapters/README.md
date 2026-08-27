# @bookone/adapters

Concrete implementations of the outbound ports declared in
`@bookone/core/adapters`. The domain depends on the interface; only this package
knows a vendor exists.

## Mock-first (ADR-008)

WS-C (Ericsoft API access) is a 2–5 month external queue, and the exception
paths are the hardest code in the sync engine — they need failure conditions to
exist before the real API does. So `MockEricsoftAdapter` ships first, with
deterministic fixtures plus configurable latency and failure injection.

**The real adapter must pass the mock's contract-test suite before it replaces
the mock.** The suite runs against both implementations; divergence is a build
failure, not a surprise in production.

| Path                | Owns                                             | Filled by    |
| ------------------- | ------------------------------------------------ | ------------ |
| `src/pms`           | `PmsAdapter` contract tests, shared fixtures     | day-1 task 4 |
| `src/mock-ericsoft` | `MockEricsoftAdapter` + failure injection        | day-1 task 4 |
| `src/payment`       | Stripe adapter behind `PaymentAdapter` (ADR-010) | Sprint 4     |
