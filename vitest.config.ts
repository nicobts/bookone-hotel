import { defineConfig } from 'vitest/config'

// Root project list. Each workspace package owns its own vitest.config.ts;
// this file is what the CI gates run against (docs/04-IMPLEMENTATION-PLAN.md §6).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
