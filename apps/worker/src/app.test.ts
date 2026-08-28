import { describe, expect, it } from 'vitest'
import { createApp } from './app'

/** Stand-ins: these tests exercise routing, not the queue or the connector. */
const deps = {
  queue: {
    send: async () => 'job-1',
    work: async () => undefined,
    schedule: async () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
  },
  adapter: {
    system: 'mock',
    healthCheck: async () => ({ healthy: true, checkedAt: new Date() }),
  },
  logger: { info: () => undefined },
} as never

const app = createApp(deps)

describe('worker http surface', () => {
  it('reports health', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'ok', service: 'worker' })
  })

  it('404s an unknown route', async () => {
    const res = await app.request('/nope')

    expect(res.status).toBe(404)
  })
})
