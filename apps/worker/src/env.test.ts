import { describe, expect, it } from 'vitest'
import { loadEnv } from './env'

/** The one variable with no sensible default. */
const required = { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres' }

describe('loadEnv', () => {
  it('applies defaults for local development', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      WORKER_PORT: 8787,
      LOG_LEVEL: 'info',
    })
  })

  it('coerces the port from a string', () => {
    expect(loadEnv({ ...required, WORKER_PORT: '9000' }).WORKER_PORT).toBe(9000)
  })

  it('fails loudly on an unusable value rather than booting degraded', () => {
    expect(() => loadEnv({ ...required, WORKER_PORT: 'not-a-port' })).toThrow(
      /Invalid worker environment/,
    )
    expect(() => loadEnv({ ...required, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/)
  })

  it('refuses to boot without a database url', () => {
    // pg-boss would otherwise fail on its first poll, a minute after boot, in
    // a log nobody is reading — rather than here, where the process refuses to
    // start and says which variable is missing.
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/)
  })
})
