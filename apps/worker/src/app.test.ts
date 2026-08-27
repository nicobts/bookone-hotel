import { describe, expect, it } from 'vitest'
import { app } from './app'

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
