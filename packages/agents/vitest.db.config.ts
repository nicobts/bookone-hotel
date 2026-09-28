import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/**
 * The agents' database suite (WP0.3): the Guest Desk tools against a real
 * database. Runs in CI's `rls` job, after core's (turbo `^test:rls`), because
 * core's suite truncates every table and the two must never overlap. This one
 * creates its own property and deletes only that.
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
    name: 'agents:db',
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    env: loadEnv(),
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
