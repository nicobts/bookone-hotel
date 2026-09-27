import { Writable } from 'node:stream'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { REDACT_PATHS, REDACTED, scrubText, startTelemetry } from './index'

function capture() {
  const lines: Record<string, unknown>[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>)
      done()
    },
  })
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: REDACTED } }, stream)
  return { logger, lines }
}

describe('log redaction (ADR-036 §5)', () => {
  it('removes personal values at the top level and one level down', () => {
    const { logger, lines } = capture()
    logger.info(
      {
        email: 'eva@example.test',
        guest: { name: 'Eva Test', phone: '+393331234567' },
        message: 'A che ora è la colazione?',
        propertyId: 'p1',
        jobId: 'j1',
      },
      'turn',
    )

    const line = lines[0]!
    expect(line.email).toBe(REDACTED)
    expect(line.message).toBe(REDACTED)
    expect(line.guest).toEqual({ name: REDACTED, phone: REDACTED })
    // Ids stay: they are what makes a log line useful, and they are not personal.
    expect(line.propertyId).toBe('p1')
    expect(line.jobId).toBe('j1')
    expect(JSON.stringify(line)).not.toContain('Eva')
  })
})

describe('URL scrubbing (ADR-036 §5)', () => {
  it('keeps the route and drops the stay token', () => {
    expect(
      scrubText(
        'fetch GET http://localhost:3000/de/stay/v1.90272b8e-e91e-4477-af49-7da6f8268c76.1790812800.9OuIx-Pv_trs8',
      ),
    ).toBe('fetch GET http://localhost:3000/de/stay/{token}')
  })

  it('drops payment intents and token-like query values', () => {
    expect(scrubText('/pay/pi_3Qx9abcdefghijklmnop')).toBe('/pay/{intent}')
    expect(scrubText('/auth/callback?code=abc123&next=/it')).toBe(
      '/auth/callback?code={redacted}&next=/it',
    )
    expect(scrubText('/it/demo-trieste/console/today')).toBe('/it/demo-trieste/console/today')
  })
})

describe('startTelemetry', () => {
  it('is off without an endpoint, and says so', async () => {
    const handle = startTelemetry({ serviceName: 'test', env: {} })
    expect(handle.enabled).toBe(false)
    await expect(handle.shutdown()).resolves.toBeUndefined()
  })

  it('is off when explicitly disabled, even with an endpoint', () => {
    const handle = startTelemetry({
      serviceName: 'test',
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', OTEL_SDK_DISABLED: 'true' },
    })
    expect(handle.enabled).toBe(false)
  })
})

describe('every service starts telemetry (ADR-036 §1)', () => {
  it('finds startTelemetry in the entry point of every app', async () => {
    const { readdirSync, existsSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const apps = join(__dirname, '..', '..', '..', 'apps')

    const missing = readdirSync(apps, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((app) => {
        // Node services start it in index.ts; Next apps in instrumentation.node.ts.
        const entries = ['src/index.ts', 'src/instrumentation.node.ts']
          .map((file) => join(apps, app, file))
          .filter((file) => existsSync(file))
        return !entries.some((file) => readFileSync(file, 'utf8').includes('startTelemetry('))
      })

    expect(missing).toEqual([])
  })
})
