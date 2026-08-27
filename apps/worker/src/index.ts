import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { app } from './app'
import { loadEnv } from './env'

// ADR-003: persistent Node process. Not edge, not serverless — see README.
const env = loadEnv()
const logger = pino({ level: env.LOG_LEVEL })

const server = serve({ fetch: app.fetch, port: env.WORKER_PORT }, (info) => {
  logger.info({ port: info.port, env: env.NODE_ENV }, 'worker listening')
})

// The process holds pg-boss subscriptions and connector polling loops, so a
// clean shutdown has to drain rather than exit. Handlers land with the queue
// wiring in Sprint 2.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down')
    server.close(() => process.exit(0))
  })
}
