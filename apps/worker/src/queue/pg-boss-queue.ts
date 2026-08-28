import { PgBoss, type Job as BossJob } from 'pg-boss'
import { jobNames } from '@bookone/core/jobs'
import type {
  Job,
  JobHandler,
  JobName,
  JobPayloads,
  JobQueue,
  SendOptions,
} from '@bookone/core/jobs'

/**
 * pg-boss behind the `JobQueue` port (ADR-005).
 *
 * On the same Postgres as everything else, which is the point: one fewer
 * stateful service, EU residency inherited, and — the part that matters most —
 * an enqueue can share a transaction with the domain write that caused it. A
 * queue in Redis cannot do that, so a crash between "reservation confirmed" and
 * "reflect enqueued" would leave a booking the PMS never hears about.
 *
 * This class is the only file in the repo that imports pg-boss.
 *
 * Written against the installed version's own type definitions, not against
 * recalled API: pg-boss 10 introduced explicit queue creation and reshaped the
 * work handler, and the old shapes fail at runtime rather than at compile time.
 */
export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss
  private started = false

  constructor(connectionString: string) {
    this.boss = new PgBoss({
      connectionString,
      // Its own schema, so the queue never collides with the domain tables and
      // `supabase db reset` does not drop pending work.
      schema: 'pgboss',
    })
  }

  async start(): Promise<void> {
    if (this.started) return

    await this.boss.start()

    // Queues are explicit from pg-boss 10 onward. Creating every known name up
    // front means `send` can never target a queue that does not exist — which
    // fails at the call site, at 3am, rather than here at boot.
    for (const name of jobNames) {
      await this.boss.createQueue(name)
    }

    this.started = true
  }

  async stop(): Promise<void> {
    if (!this.started) return
    // Graceful: let in-flight jobs finish rather than orphaning a reflection
    // halfway through a call to a hotel's PMS.
    await this.boss.stop({ graceful: true })
    this.started = false
  }

  async send<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options: SendOptions = {},
  ): Promise<string | null> {
    return this.boss.send(name, data as object, {
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      retryLimit: options.retryLimit ?? 5,
      retryDelay: options.retryDelaySeconds ?? 30,
      // A PMS that is down stays down for minutes. Hammering it every 30
      // seconds neither helps us nor endears us to them.
      retryBackoff: true,
    })
  }

  async work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void> {
    // The handler receives a batch; we take one at a time so a single failing
    // job cannot fail its neighbours' acknowledgement.
    // Polling is configured per worker in pg-boss 12, not on the constructor.
    // Two seconds sits well inside the 60s PRD A3 allows a reflection, and it
    // is a correctness floor rather than the mechanism — notify wakes a worker
    // sooner when it is available.
    const options = { pollingIntervalSeconds: 2 }

    await this.boss.work<JobPayloads[N]>(name, options, async (jobs: BossJob<JobPayloads[N]>[]) => {
      for (const job of jobs) {
        await handler({ id: job.id, name, data: job.data } as Job<N>)
      }
    })
  }

  async schedule<N extends JobName>(name: N, cron: string, data: JobPayloads[N]): Promise<void> {
    // Property-local time matters here: "nightly" for a hotel means after its
    // own last checkout, not at 02:00 UTC.
    await this.boss.schedule(name, cron, data as object, { tz: 'Europe/Rome' })
  }
}
