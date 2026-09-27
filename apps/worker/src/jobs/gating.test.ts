import { describe, expect, it, vi } from 'vitest'
import { jobNames, type JobName } from '@bookone/core/jobs'
import { FEATURES, JOB_FEATURE, PHASE0_FEATURES } from '@bookone/core/onboarding'
import { registerHandlers } from './handlers'
import { syncPropertySchedules } from './schedules'

/**
 * Job-side gating (ADR-019).
 *
 * The queue is a fake that records what was registered and scheduled; no
 * handler that would touch a database is ever invoked.
 */
function fakeQueue(existing: Partial<Record<JobName, string[]>> = {}) {
  const handlers = new Map<string, (job: { id: string; data: unknown }) => Promise<void>>()
  const scheduled: { name: string; key: string | undefined }[] = []
  const unscheduled: { name: string; key: string | undefined }[] = []

  const queue = {
    work: async (name: string, handler: (job: { id: string; data: unknown }) => Promise<void>) => {
      handlers.set(name, handler)
    },
    send: vi.fn(async () => 'job-1'),
    schedule: async (name: string, _cron: string, _data: unknown, options?: { key?: string }) => {
      scheduled.push({ name, key: options?.key })
    },
    listSchedules: async (name: JobName) => (existing[name] ?? []).map((key) => ({ name, key })),
    unschedule: async (name: string, key?: string) => {
      unscheduled.push({ name, key })
    },
    start: async () => undefined,
    stop: async () => undefined,
  }

  return { queue, handlers, scheduled, unscheduled }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function checkFor(features: readonly string[]) {
  const enabled = new Set<string>(features)
  return () => async (_propertyId: string, feature: string) => enabled.has(feature)
}

async function register(features: readonly string[]) {
  const fake = fakeQueue()

  await registerHandlers({
    queue: fake.queue,
    logger,
    featureCheck: checkFor(features),
  } as never)

  return fake
}

describe('handlers', () => {
  it('registers a handler for every job — a job with no consumer succeeds at nothing', async () => {
    const { handlers } = await register(FEATURES)

    expect([...handlers.keys()].sort()).toEqual([...jobNames].sort())
  })

  it.each(jobNames.filter((name) => JOB_FEATURE[name] !== 'core'))(
    '%s does nothing for a property without its feature',
    async (name) => {
      const { handlers } = await register([])
      logger.info.mockClear()

      // If the gate let this through, the real handler would run against a
      // database that is not there and the test would throw.
      await handlers.get(name)?.({ id: 'j1', data: { propertyId: 'p1' } })

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ job: name, propertyId: 'p1', feature: JOB_FEATURE[name] }),
        'skipped: feature off',
      )
    },
  )
})

describe('per-property schedules', () => {
  const twoProperties = async () => [{ id: 'p1' }, { id: 'p2' }]

  it('with every feature off, schedules only the core per-property work', async () => {
    const fake = fakeQueue()

    await syncPropertySchedules({
      queue: fake.queue as never,
      logger,
      features: checkFor([])(),
      listProperties: twoProperties,
    })

    // Retention is privacy work and runs whatever a property has bought.
    expect(fake.scheduled).toEqual([
      { name: 'retention.sweep', key: 'p1' },
      { name: 'retention.sweep', key: 'p2' },
    ])
  })

  it('with the Phase 0 set, adds nothing that needs a PMS', async () => {
    // Phase 0 has no `pms_sync`: a demo property has no Ericsoft to reconcile.
    const fake = fakeQueue()

    await syncPropertySchedules({
      queue: fake.queue as never,
      logger,
      features: checkFor(PHASE0_FEATURES)(),
      listProperties: twoProperties,
    })

    expect(fake.scheduled.map((s) => s.name)).toEqual(['retention.sweep', 'retention.sweep'])
  })

  it('schedules PMS work for a property granted pms_sync', async () => {
    const fake = fakeQueue()

    await syncPropertySchedules({
      queue: fake.queue as never,
      logger,
      features: checkFor(['pms_sync'])(),
      listProperties: async () => [{ id: 'p1' }],
    })

    expect(fake.scheduled).toEqual([
      { name: 'reconcile.nightly', key: 'p1' },
      { name: 'availability.refresh', key: 'p1' },
      { name: 'retention.sweep', key: 'p1' },
    ])
  })

  it('removes a schedule when its feature is revoked — no restart', async () => {
    const fake = fakeQueue({
      'reconcile.nightly': ['p1'],
      'availability.refresh': ['p1'],
      'retention.sweep': ['p1'],
    })

    const outcome = await syncPropertySchedules({
      queue: fake.queue as never,
      logger,
      features: checkFor([])(),
      listProperties: async () => [{ id: 'p1' }],
    })

    expect(fake.unscheduled).toEqual([
      { name: 'reconcile.nightly', key: 'p1' },
      { name: 'availability.refresh', key: 'p1' },
    ])
    expect(outcome.removed).toBe(2)
  })
})
