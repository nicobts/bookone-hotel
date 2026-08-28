import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    // Off the moment this package has its first test file — an empty suite
    // must not read as a green gate (docs/04 §3).
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    // The isolation suites need a live database and are their own CI gate.
    // Keeping them out of `pnpm test` means a unit-test run does not silently
    // depend on Docker being up.
    exclude: ['**/node_modules/**', 'src/db/__tests__/rls/**'],
  },
})
