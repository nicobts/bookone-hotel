import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'agents',
    environment: 'node',
    // Off the moment this package has its first test file — an empty suite
    // must not read as a green gate (docs/04 §3).
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    // Eval sets are their own CI gate, so a prompt or model change that
    // regresses a golden set fails under its own name rather than inside the
    // general test run (06 §4).
    exclude: ['**/node_modules/**', 'src/evals/**'],
  },
})
