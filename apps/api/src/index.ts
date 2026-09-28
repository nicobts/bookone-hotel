import { existsSync } from 'node:fs'
import { createLogger, startTelemetry } from '@bookone/telemetry'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { MockEricsoftAdapter } from '@bookone/adapters/mock-ericsoft'
import { MockPaymentAdapter } from '@bookone/adapters/mock-payment'
import { PgBossQueue } from '@bookone/adapters/pg-boss'
import { createApp } from './app'
import { loadEnv } from './env'

/**
 * `apps/api` — provider webhooks, health and the internal `/jobs/*` surface
 * (ADR-034).
 *
 * It answers requests and enqueues; `apps/worker` runs the jobs. The split
 * exists so that a webhook burst and a slow nightly job no longer share one
 * event loop, and so that deploying job code does not restart the endpoint a
 * payment provider is posting to.
 *
 * A persistent Node process like the worker, never edge or serverless
 * (ADR-003's constraint, restated in ADR-034).
 */

// The repo-root `.env` for local development; see apps/worker/src/index.ts
// for why this is not node's `--env-file`.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

const env = loadEnv()

/**
 * OpenTelemetry first (ADR-036): traces, metrics and logs over OTLP when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, nothing at all when it is not. The
 * logger is redacted and carries the trace id on every line.
 */
const telemetry = startTelemetry({ serviceName: 'bookone-api' })
const logger = createLogger({ name: 'bookone-api', level: env.LOG_LEVEL })

/**
 * The PMS connector, for `/health/connector` only. Mock until WS-C clears
 * (ADR-008); the worker holds the instance that syncs.
 */
const adapter = new MockEricsoftAdapter({
  now: () => new Date(),
  roomTypeCodes: ['DBL', 'SGL', 'FAM'],
})

/**
 * The payment provider: the webhook's signature check lives here, and so does
 * the simulated checkout.
 *
 * MEMO — SIMULATED (ADR-010). The mock keeps its intents in this process's
 * memory, so the worker's `payment.replay` cannot see them and skips them; a
 * real provider holds that state itself and the split changes nothing. Refuses
 * to boot simulated in production, exactly as the worker does.
 */
const payments = new MockPaymentAdapter({
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  checkoutBaseUrl: env.APP_URL,
})

if (env.NODE_ENV === 'production' && payments.simulated) {
  throw new Error(
    `Refusing to start: payment provider "${payments.provider}" is simulated and ` +
      'NODE_ENV=production. Connect a real PaymentAdapter (ADR-010) before deploying.',
  )
}

/** Sends only: no supervision, no schedules — those are the worker's (ADR-034). */
const queue = new PgBossQueue(env.DATABASE_URL, 'producer')
await queue.start()

const app = createApp({
  queue,
  adapter,
  payments,
  logger,
  internalToken: env.WORKER_INTERNAL_TOKEN,
  appUrl: env.APP_URL,
  allowSimulation: env.NODE_ENV !== 'production',
  webhookRateLimit: env.WEBHOOK_RATE_LIMIT,
  trustProxy: env.TRUST_PROXY,
  remoteAddress: (c) => getConnInfo(c).remote.address ?? null,
  ...(env.TWILIO_AUTH_TOKEN && env.TWILIO_WEBHOOK_BASE_URL
    ? { twilio: { authToken: env.TWILIO_AUTH_TOKEN, publicBaseUrl: env.TWILIO_WEBHOOK_BASE_URL } }
    : {}),
})

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      env: env.NODE_ENV,
      payments: payments.provider,
      paymentsSimulated: payments.simulated,
    },
    'api listening',
  )
})

let shuttingDown = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal }, 'shutting down')

    // Stop taking requests first, then let the queue client finish sending.
    server.close(() => {
      void queue
        .stop()
        .then(() => telemetry.shutdown())
        .then(() => process.exit(0))
    })
  })
}
