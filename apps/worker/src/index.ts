import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { MockEricsoftAdapter } from '@bookone/adapters/mock-ericsoft'
import { MockPaymentAdapter } from '@bookone/adapters/mock-payment'
import { getNotificationProvider, registerNotificationProvider } from '@bookone/core/notifications'
import { createApp } from './app'
import { LogNotificationProvider } from './notifications/log-provider'
import { loadEnv } from './env'
import { registerHandlers } from './jobs/handlers'
import { registerSchedules } from './jobs/schedules'
import { PgBossQueue } from './queue/pg-boss-queue'

/**
 * The repo-root `.env`, for local development.
 *
 * Loaded here rather than through node's `--env-file` flag in the dev script:
 * `tsx watch` re-executes the entry on change without re-passing node's own CLI
 * flags, so the first boot finds its configuration and every reload after it
 * does not — a failure that reads as "the code broke" rather than "the
 * environment vanished".
 *
 * Deployed environments supply real environment variables and have no file
 * here, which is why the check is silent rather than a startup crash. Nothing
 * already set is overwritten, so an explicit variable always wins.
 */
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

// ADR-003: persistent Node process. Not edge, not serverless — see README.
// The queue subscriptions and connector polling below are exactly why.
const env = loadEnv()
const logger = pino({ level: env.LOG_LEVEL })

/**
 * The PMS connector.
 *
 * Mock until WS-C clears (ADR-008). The real adapter drops in here and nothing
 * else changes — it implements the same interface and has already passed the
 * same contract suite, which is the precondition for the swap.
 */
const adapter = new MockEricsoftAdapter({
  // A live clock. The mock's default is a fixed instant, which is right for
  // tests and wrong here: `fetched_at` is what the booking surface checks for
  // staleness, and a frozen timestamp would either vouch for a cache that has
  // not been refreshed in days or condemn one refreshed a second ago.
  now: () => new Date(),

  // The codes the seeded properties actually use. A real PMS knows the hotel's
  // room types; the mock has to be told, and telling it wrong is invisible —
  // the refresh logs a `skipped` count and the booking page quietly stops
  // offering that room. Keep this in step with `scripts/seed-dev.mjs`.
  roomTypeCodes: ['DBL', 'SGL', 'FAM'],
})

/**
 * The payment provider.
 *
 * MEMO — SIMULATED. `MockPaymentAdapter` moves no money (ADR-010, staged the
 * same way ADR-008 staged the PMS connector). The interface, the policy engine,
 * the ledger, the webhook path and its signature check are all real; the card
 * form and the authorisation are not.
 *
 * The guard below is what keeps that a staging decision rather than an accident
 * waiting to happen. It is deliberately a hard exit and not a warning: a
 * warning in a startup log is a warning nobody reads until a guest has been
 * shown a payment page that takes no money.
 */
const paymentAdapter = new MockPaymentAdapter({
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  checkoutBaseUrl: env.APP_URL,
})

if (env.NODE_ENV === 'production' && paymentAdapter.simulated) {
  throw new Error(
    `Refusing to start: payment provider "${paymentAdapter.provider}" is simulated and ` +
      'NODE_ENV=production. Connect a real PaymentAdapter (ADR-010) before deploying.',
  )
}

const queue = new PgBossQueue(env.DATABASE_URL)

/**
 * Registration is the D9 gate, not a lookup table (ADR-012's pattern, applied
 * to an ESP). A provider that cannot declare EU processing, a region, a
 * sub-processor register entry and a verification inside a year is refused
 * here — at boot, loudly, before a guest's address is ever handed to it.
 */
registerNotificationProvider(new LogNotificationProvider(logger))

const notifications = getNotificationProvider(env.NOTIFICATION_PROVIDER)

const app = createApp({
  queue,
  adapter,
  payments: paymentAdapter,
  logger,
  internalToken: env.WORKER_INTERNAL_TOKEN,
  appUrl: env.APP_URL,
  allowSimulation: env.NODE_ENV !== 'production',
})

const server = serve({ fetch: app.fetch, port: env.WORKER_PORT }, (info) => {
  logger.info({ port: info.port, env: env.NODE_ENV }, 'worker listening')
})

await queue.start()
await registerHandlers({ queue, adapter, payments: paymentAdapter, notifications, logger })
await registerSchedules({ queue, logger })
logger.info(
  {
    adapter: adapter.system,
    notifications: notifications.name,
    payments: paymentAdapter.provider,
    // Printed on every boot on purpose. "Which environment is taking real
    // money" should never be a question anyone has to go and look up.
    paymentsSimulated: paymentAdapter.simulated,
  },
  'queue started, handlers registered',
)

/**
 * Drain rather than exit.
 *
 * This process holds queue subscriptions and, later, connector polling loops. A
 * hard exit mid-reflection leaves a job claimed but unfinished, and it stays
 * that way until the visibility timeout expires — which is a booking the hotel
 * has not heard about for as long as that takes.
 */
let shuttingDown = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal }, 'shutting down')

    void (async () => {
      await queue.stop()
      server.close(() => process.exit(0))
    })()
  })
}
