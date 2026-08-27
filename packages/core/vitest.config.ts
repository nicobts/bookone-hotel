import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    // Off the moment this package has its first test file — an empty suite
    // must not read as a green gate (docs/04 §3).
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
  },
})
