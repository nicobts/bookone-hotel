import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The isolation suites need a live database and are their own CI gate.
    // Keeping them out of `pnpm test` means a unit-test run does not silently
    // depend on Docker being up.
    exclude: ['**/node_modules/**', 'src/db/__tests__/rls/**'],
  },
})
