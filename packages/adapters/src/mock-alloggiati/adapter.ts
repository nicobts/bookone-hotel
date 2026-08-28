import { createHash, randomUUID } from 'node:crypto'
import {
  AlloggiatiError,
  type AcknowledgementResult,
  type AlloggiatiAdapter,
  type SubmitInput,
  type SubmitResult,
} from '@bookone/core/alloggiati'
import { RECORD_WIDTH } from '@bookone/core/alloggiati'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MEMO — NOTHING IS FILED WITH ANY AUTHORITY. NO CHANNEL IS CONNECTED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A stand-in for the Alloggiati channel while the direct-web-service versus
 * certified-intermediary decision is open (04 §0 item 5). Staged the same way
 * the PMS connector was (ADR-008) and payments were (ADR-010).
 *
 * **What is real:** the payload builder, the validation, the `alloggiati_
 * submissions` audit trail, the journey transitions, the retry, the T-20h
 * alert, and the document-deletion job that fires on acknowledgement.
 *
 * **What is not:** the filing. This class checks the shape of what it is given
 * and hands back a plausible receipt.
 *
 * ## It validates rather than accepting anything
 *
 * A mock that said yes to everything would let a malformed payload reach
 * production untested, and the first real submission would be the first time
 * anything checked the width of a line. So this one rejects records that are
 * not exactly `RECORD_WIDTH` characters, and rejects an empty file — the two
 * failures the builder can actually produce.
 *
 * It cannot validate the *offsets*, because those are the thing that needs
 * checking against the authority's own test environment before go-live. See
 * the header of `packages/core/src/alloggiati/record.ts`.
 */

export interface MockAlloggiatiFailure {
  on: 'submit' | 'check' | 'any'
  code: 'unavailable' | 'rejected' | 'unauthorized'
  /** Fail this many times, then succeed. Counted, not random. */
  times: number
}

export interface MockAlloggiatiOptions {
  failures?: MockAlloggiatiFailure[]
  /**
   * How many acknowledgement checks return `pending` before success.
   *
   * Zero means the channel acknowledges on upload, like Alloggiati Web. Higher
   * values stand in for an intermediary that queues — and the deletion job must
   * be correct for both, since the channel is not chosen yet.
   */
  pendingChecks?: number
  now?: () => Date
}

const RETRYABLE = { unavailable: true, rejected: false, unauthorized: false } as const

export class MockAlloggiatiAdapter implements AlloggiatiAdapter {
  readonly channel = 'mock'
  readonly simulated = true

  private readonly submissions = new Map<
    string,
    { propertyId: string; checksum: string; checks: number }
  >()
  private readonly failures: MockAlloggiatiFailure[]
  private readonly pendingChecks: number
  private readonly now: () => Date
  private sequence = 0
  private readonly instance = randomUUID().slice(0, 8)

  constructor(options: MockAlloggiatiOptions = {}) {
    this.failures = (options.failures ?? []).map((failure) => ({ ...failure }))
    this.pendingChecks = options.pendingChecks ?? 0
    this.now = options.now ?? (() => new Date())
  }

  // `async`, and load-bearing rather than stylistic: this method throws, and a
  // synchronous throw from a method typed as returning a promise escapes every
  // caller's `.catch` and takes the process with it. The payment adapter had
  // exactly this bug and the contract suite caught it there too — which is the
  // argument for the suite existing.
  async submit(input: SubmitInput): Promise<SubmitResult> {
    this.gate('submit')

    const lines = input.payload.split('\r\n').filter((line) => line.length > 0)

    if (lines.length === 0) {
      throw new AlloggiatiError('rejected', 'the file contains no records', false)
    }

    const wrong = lines.findIndex((line) => line.length !== RECORD_WIDTH)
    if (wrong !== -1) {
      // The authority validates on receipt, so this is the failure a real
      // channel would produce — and producing it here is what stops a
      // malformed builder reaching a property untested.
      throw new AlloggiatiError(
        'rejected',
        `record ${wrong + 1} is ${lines[wrong]?.length} characters, expected ${RECORD_WIDTH}`,
        false,
      )
    }

    if (lines.length !== input.guestCount) {
      throw new AlloggiatiError(
        'rejected',
        `file has ${lines.length} records but ${input.guestCount} guests were declared`,
        false,
      )
    }

    this.sequence += 1
    const reference = `ALG-${this.instance}-${String(this.sequence).padStart(4, '0')}`

    this.submissions.set(reference, {
      propertyId: input.propertyId,
      checksum: createHash('sha256').update(input.payload).digest('hex'),
      checks: 0,
    })

    // Acknowledged on upload when configured that way, which is how Alloggiati
    // Web behaves. An intermediary is modelled by `pendingChecks`.
    return this.pendingChecks === 0
      ? { reference, receipt: this.receipt(reference) }
      : { reference }
  }

  async checkAcknowledgement(input: {
    propertyId: string
    reference: string
  }): Promise<AcknowledgementResult> {
    this.gate('check')

    const submission = this.submissions.get(input.reference)

    // Scoped by property, like every other lookup here. Without it the sweep
    // could resolve one property's filing using another's reference.
    if (!submission || submission.propertyId !== input.propertyId) {
      return { status: 'failed', reason: 'unknown reference' }
    }

    submission.checks += 1

    if (submission.checks <= this.pendingChecks) return { status: 'pending' }

    return { status: 'acknowledged', receipt: this.receipt(input.reference) }
  }

  healthCheck(): Promise<{ healthy: boolean; message?: string; checkedAt: Date }> {
    return Promise.resolve({
      healthy: true,
      message: 'simulated channel — nothing is filed with any authority',
      checkedAt: this.now(),
    })
  }

  private receipt(reference: string): Record<string, unknown> {
    const submission = this.submissions.get(reference)

    return {
      reference,
      // The checksum of what was actually transmitted. A real receipt carries
      // the authority's own identifiers; this at least ties the receipt to the
      // exact bytes, which is what a dispute needs.
      payloadChecksum: submission?.checksum ?? null,
      receivedAt: this.now().toISOString(),
      simulated: true,
    }
  }

  private gate(operation: MockAlloggiatiFailure['on']): void {
    const failure = this.failures.find(
      (candidate) => (candidate.on === operation || candidate.on === 'any') && candidate.times > 0,
    )

    if (!failure) return

    failure.times -= 1

    throw new AlloggiatiError(
      failure.code,
      `injected ${failure.code} on ${operation}`,
      RETRYABLE[failure.code],
    )
  }
}
