import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/**
 * The cross-tenant isolation gate (E7.2, binding rule 3).
 *
 * Two suites, one per access path — PostgREST with a user JWT, and the
 * application's own Drizzle connection. They are separated from the unit tests
 * because they need a live database, and separated from each other because
 * neither proves anything about the other (ADR-018).
 *
 * The root `.env` is read here rather than assumed to be exported: this suite
 * is run directly by CI as its own step, not only through a shell that sourced
 * it first.
 */
function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../../.env', import.meta.url), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=')
          return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')]
        }),
    )
  } catch {
    // Absent .env is not fatal — CI supplies these as real environment
    // variables, and the suite fails with a clear connection error if neither.
    return {}
  }
}

export default defineConfig({
  test: {
    name: 'core:rls',
    environment: 'node',
    include: ['src/db/__tests__/rls/**/*.test.ts'],
    env: loadEnv(),
    // Two suites truncating the same tables cannot run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
