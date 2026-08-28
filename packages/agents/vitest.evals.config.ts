import { defineConfig } from 'vitest/config'

/**
 * The agent eval gate (06-AI-AGENT-LAYER §1.5, §4).
 *
 * Golden sets, run in CI. An agent does not get production traffic before it
 * has one, and a change that regresses a set is a blocked merge — exactly like
 * a failing test, because that is what it is.
 */
export default defineConfig({
  test: {
    name: 'agents:evals',
    environment: 'node',
    include: ['src/evals/**/*.eval.ts'],
  },
})
