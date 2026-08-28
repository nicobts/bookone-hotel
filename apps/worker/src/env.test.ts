import { describe, expect, it } from 'vitest'
import { loadEnv } from './env'

/** The variables with no sensible default — a default would be a published one. */
const required = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
  WORKER_INTERNAL_TOKEN: 'a-token-long-enough-to-pass-the-check',
  PAYMENT_WEBHOOK_SECRET: 'a-webhook-secret-long-enough-to-pass',
}

describe('loadEnv', () => {
  it('applies defaults for local development', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      WORKER_PORT: 8787,
      LOG_LEVEL: 'info',
      NOTIFICATION_PROVIDER: 'log',
      PAYMENT_PROVIDER: 'mock',
      APP_URL: 'http://localhost:3000',
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

  it('refuses a short internal token rather than guarding /jobs with one', () => {
    // The endpoints behind it enqueue work against any property id in the
    // body. A guessable secret there is the same as no secret.
    expect(() => loadEnv({ ...required, WORKER_INTERNAL_TOKEN: 'short' })).toThrow(
      /WORKER_INTERNAL_TOKEN/,
    )
  })

  it('refuses a short webhook secret', () => {
    // That signature is the only authentication on an endpoint that marks
    // bookings as paid. A guessable secret there is the same as none.
    expect(() => loadEnv({ ...required, PAYMENT_WEBHOOK_SECRET: 'short' })).toThrow(
      /PAYMENT_WEBHOOK_SECRET/,
    )
  })

  it('refuses to boot without a database url', () => {
    // pg-boss would otherwise fail on its first poll, a minute after boot, in
    // a log nobody is reading — rather than here, where the process refuses to
    // start and says which variable is missing.
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/)
  })

  it('names every missing variable at once, not one per restart', () => {
    // Fixing a missing-variable error and hitting the next one is how a
    // deployment turns into four.
    const message = (() => {
      try {
        loadEnv({})
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()

    expect(message).toMatch(/DATABASE_URL/)
    expect(message).toMatch(/WORKER_INTERNAL_TOKEN/)
    expect(message).toMatch(/PAYMENT_WEBHOOK_SECRET/)
  })
})
