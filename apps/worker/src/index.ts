import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { MockEricsoftAdapter } from '@bookone/adapters/mock-ericsoft'
import { createApp } from './app'
import { loadEnv } from './env'
import { registerHandlers } from './jobs/handlers'
import { PgBossQueue } from './queue/pg-boss-queue'

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
const adapter = new MockEricsoftAdapter()

const queue = new PgBossQueue(env.DATABASE_URL)

const app = createApp({ queue, adapter, logger })

const server = serve({ fetch: app.fetch, port: env.WORKER_PORT }, (info) => {
  logger.info({ port: info.port, env: env.NODE_ENV }, 'worker listening')
})

await queue.start()
await registerHandlers({ queue, adapter, logger })
logger.info({ adapter: adapter.system }, 'queue started, handlers registered')

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
