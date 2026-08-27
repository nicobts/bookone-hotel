import { describe, expect, it } from 'vitest'
import { loadEnv } from './env'

describe('loadEnv', () => {
  it('applies defaults for local development', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      WORKER_PORT: 8787,
      LOG_LEVEL: 'info',
    })
  })

  it('coerces the port from a string', () => {
    expect(loadEnv({ WORKER_PORT: '9000' }).WORKER_PORT).toBe(9000)
  })

  it('fails loudly on an unusable value rather than booting degraded', () => {
    expect(() => loadEnv({ WORKER_PORT: 'not-a-port' })).toThrow(/Invalid worker environment/)
    expect(() => loadEnv({ LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/)
  })
})
