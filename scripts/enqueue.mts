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
import { existsSync } from 'node:fs'
import { PgBossQueue } from '../apps/worker/src/queue/pg-boss-queue'

// Same reason as demo-stay.mts: without this the script only runs in a shell
// that already exported DATABASE_URL.
if (existsSync(new URL('../.env', import.meta.url))) {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
}

const [, , name, propertyId] = process.argv

/** Sweeps take no payload: they find their own work across every property. */
const SWEEPS = new Set(['precheckin', 'escalation', 'audit', 'departure', 'invoice'])

if (!name || (!propertyId && !SWEEPS.has(name))) {
  console.error(
    'usage: enqueue.mts <availability|reconcile|agent> <propertyId>\n' +
      '       enqueue.mts <precheckin|escalation|audit|departure|invoice>',
  )
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
  case 'precheckin':
    // No payload: the sweep finds every stay due its invitation (E2.1).
    await queue.send('precheckin.sweep', {})
    break
  case 'escalation':
    await queue.send('escalation.sweep', {})
    break
  case 'audit':
    await queue.send('toolboundary.audit', {})
    break
  case 'departure':
    await queue.send('departure.sweep', {})
    break
  case 'invoice':
    await queue.send('invoice.route', {})
    break
  default:
    console.error(`unknown job: ${name}`)
    process.exit(1)
}

console.log(propertyId ? `enqueued ${name} for ${propertyId}` : `enqueued ${name}`)
await queue.stop()
process.exit(0)
