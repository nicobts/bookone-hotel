// MockEricsoftAdapter — deterministic fixtures with configurable latency and
// failure injection (03-ARCHITECTURE §4, ADR-008).
//
// The injection surface is the point: reflection failures, timeouts and stale
// availability have to be reproducible so the exceptions inbox and its
// resolution actions get built and tested in Sprint 2, years before the real
// API teaches us its own quirks.
//
// Fills in day-1 task 4.
export {}
