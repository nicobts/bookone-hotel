/**
 * Enqueue a job by hand, through the real queue.
 *
 * A development convenience for exercising handlers that have no HTTP trigger
 * — reconciliation runs on a schedule and agents run off events, so neither is
 * reachable from a browser. Uses `PgBossQueue` rather than writing to pg-boss's
 * tables directly, so what it exercises is the path production takes.
 *
 *   pnpm tsx scripts/enqueue.mts reconcile <propertyId>
 */
import { PgBossQueue } from '../apps/worker/src/queue/pg-boss-queue'

const [, , name, propertyId] = process.argv

if (!name || !propertyId) {
  console.error('usage: enqueue.mts <availability|reconcile|agent> <propertyId>')
  process.exit(1)
}

const queue = new PgBossQueue(process.env.DATABASE_URL ?? '')
await queue.start()

switch (name) {
  case 'availability':
    await queue.send('availability.refresh', { propertyId, from: '2026-12-01', to: '2026-12-04' })
    break
  case 'reconcile':
    await queue.send('reconcile.nightly', { propertyId, domain: 'booking' })
    break
  case 'agent':
    await queue.send('agent.run', { propertyId, agent: 'AG-05' })
    break
  default:
    console.error(`unknown job: ${name}`)
    process.exit(1)
}

console.log(`enqueued ${name} for ${propertyId}`)
await queue.stop()
process.exit(0)
