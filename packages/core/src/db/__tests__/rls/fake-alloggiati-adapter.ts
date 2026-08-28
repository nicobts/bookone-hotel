import { createHash, randomUUID } from 'node:crypto'
import {
  AlloggiatiError,
  RECORD_WIDTH,
  type AcknowledgementResult,
  type AlloggiatiAdapter,
  type SubmitInput,
  type SubmitResult,
} from '../../../alloggiati'

/**
 * An Alloggiati channel stand-in, local to core's tests.
 *
 * Local rather than importing `MockAlloggiatiAdapter` from `@bookone/adapters`,
 * because that package depends on this one and the import would close a build
 * cycle — the same lesson the reflection and payment tests learned. The rule it
 * enforces is a good one: core is tested against its ports, never against an
 * implementation of them.
 */
export class FakeAlloggiatiAdapter implements AlloggiatiAdapter {
  readonly channel = 'fake'
  readonly simulated = true

  /** Counts real calls, so "does not file twice" can be asserted directly. */
  submitCount = 0

  private readonly filings = new Map<string, { propertyId: string; checks: number }>()
  private readonly pendingChecks: number
  private failSubmitTimes: number
  private readonly instance = randomUUID().slice(0, 8)
  private sequence = 0

  constructor(options: { pendingChecks?: number; failSubmitTimes?: number } = {}) {
    this.pendingChecks = options.pendingChecks ?? 0
    this.failSubmitTimes = options.failSubmitTimes ?? 0
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    if (this.failSubmitTimes > 0) {
      this.failSubmitTimes -= 1
      throw new AlloggiatiError('unavailable', 'injected channel failure', true)
    }

    const lines = input.payload.split('\r\n').filter(Boolean)
    if (lines.some((line) => line.length !== RECORD_WIDTH)) {
      throw new AlloggiatiError('rejected', 'a record is the wrong width', false)
    }

    this.submitCount += 1
    this.sequence += 1

    // Unique per instance, like a real channel. Two adapters sharing a database
    // collided on `external_refs` the last time a fake reused ids.
    const reference = `FAKE-${this.instance}-${this.sequence}`
    this.filings.set(reference, { propertyId: input.propertyId, checks: 0 })

    return this.pendingChecks === 0
      ? { reference, receipt: this.receipt(reference, input.payload) }
      : { reference }
  }

  async checkAcknowledgement(input: {
    propertyId: string
    reference: string
  }): Promise<AcknowledgementResult> {
    const filing = this.filings.get(input.reference)
    if (!filing || filing.propertyId !== input.propertyId) {
      return { status: 'failed', reason: 'unknown reference' }
    }

    filing.checks += 1
    if (filing.checks <= this.pendingChecks) return { status: 'pending' }

    return { status: 'acknowledged', receipt: this.receipt(input.reference, '') }
  }

  healthCheck(): Promise<{ healthy: boolean; checkedAt: Date }> {
    return Promise.resolve({ healthy: true, checkedAt: new Date() })
  }

  private receipt(reference: string, payload: string): Record<string, unknown> {
    return {
      reference,
      payloadChecksum: createHash('sha256').update(payload).digest('hex'),
      simulated: true,
    }
  }
}
