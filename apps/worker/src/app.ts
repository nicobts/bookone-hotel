import { Hono } from 'hono'

/**
 * The worker's HTTP surface.
 *
 * Deliberately thin: this process exists for jobs, connectors and the agent
 * runner. What it exposes over HTTP is health, and later the typed tool
 * endpoints shared with the voice concierge workstream (WS-B).
 *
 * Routes are chained rather than registered separately so the exported type
 * carries them — that type is what gives `apps/web` end-to-end types through
 * Hono RPC without codegen (ADR-004, binding rule 10).
 */
export const app = new Hono().get('/health', (c) =>
  c.json({
    status: 'ok' as const,
    service: 'worker' as const,
  }),
)

export type AppType = typeof app
