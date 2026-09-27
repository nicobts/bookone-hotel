import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { name: 'telemetry', environment: 'node', include: ['src/**/*.test.ts'] },
})
