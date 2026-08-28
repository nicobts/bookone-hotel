// The shared PmsAdapter contract-test suite.
//
// Every implementation runs these same assertions. Passing them is the
// precondition for replacing the mock with the real connector (ADR-008) — the
// swap is this file going green, not a judgement about whether the code looks
// right.
export * from './contract'
