import type {
  ComplianceAdapter,
  ComplianceCapabilities,
  ManualFallback,
  ObligationInput,
  SubmitResult,
  ValidationResult,
} from '@bookone/core/compliance'
import type { Feature } from '@bookone/core/onboarding'

/**
 * A simulated authority (WP1.1): the fake the contract suite and the lifecycle
 * are proven against, before any real authority is connected.
 *
 * Files nothing. It keeps what it was sent in memory, answers like a queued
 * channel when told to (`acknowledgeAfter`), and fails on demand with counted,
 * retryable or permanent failures — the same injection style as the other
 * mocks (ADR-008).
 */
export interface MockComplianceOptions {
  id?: string
  authority?: string
  feature?: Feature
  /** How many times a filing must be asked about before it is acknowledged. 0: on upload. */
  acknowledgeAfter?: number
  retryPolicy?: Partial<ComplianceCapabilities['retryPolicy']>
}

interface Filing {
  reference: string
  asked: number
}

export class MockComplianceAdapter implements ComplianceAdapter {
  readonly filings = new Map<string, Filing>()
  private failures: { retryable: boolean }[] = []
  private sequence = 0
  private readonly caps: ComplianceCapabilities
  private readonly acknowledgeAfter: number

  constructor(options: MockComplianceOptions = {}) {
    this.acknowledgeAfter = options.acknowledgeAfter ?? 0
    this.caps = {
      id: options.id ?? 'mock-authority',
      authority: options.authority ?? 'mock-authority',
      feature: options.feature ?? 'alloggiati',
      jurisdiction: { level: 'national', country: 'IT' },
      obligationTypes: ['guest_registration', 'istat_movement', 'tourist_tax_declaration'],
      transport: 'web_service',
      evidenceType: 'receipt',
      retryPolicy: {
        maxAttempts: 3,
        backoffSeconds: 60,
        maxBackoffSeconds: 600,
        manualBeforeDeadlineMinutes: 60,
        ...options.retryPolicy,
      },
      manualFallback: {
        contentType: 'text/csv',
        description: 'A CSV of the obligation, for a simulated portal.',
      },
      simulated: true,
    }
  }

  capabilities(): ComplianceCapabilities {
    return this.caps
  }

  /** The next submit that would reach the channel fails, once. */
  failNext(retryable: boolean, times = 1): void {
    for (let i = 0; i < times; i += 1) this.failures.push({ retryable })
  }

  async validate(obligation: ObligationInput): Promise<ValidationResult> {
    if (!obligation.reservationId && !obligation.periodDate) {
      return {
        ok: false,
        issues: [{ code: 'no-subject', message: 'The obligation names neither a stay nor a day.' }],
      }
    }
    return { ok: true }
  }

  async submit(obligation: ObligationInput): Promise<SubmitResult> {
    const existing = this.filings.get(obligation.obligationId)

    if (existing) {
      existing.asked += 1
      return this.answer(existing)
    }

    const failure = this.failures.shift()
    if (failure) {
      return {
        status: 'failed',
        code: failure.retryable ? 'unavailable' : 'rejected',
        message: failure.retryable
          ? 'The simulated authority did not answer.'
          : 'The simulated authority rejected the filing.',
        retryable: failure.retryable,
      }
    }

    this.sequence += 1
    const filing = { reference: `MOCK-${String(this.sequence).padStart(5, '0')}`, asked: 0 }
    this.filings.set(obligation.obligationId, filing)
    return this.answer(filing)
  }

  async manualFallback(obligation: ObligationInput): Promise<ManualFallback> {
    return {
      filename: `mock-${obligation.obligationId.slice(0, 8)}.csv`,
      contentType: 'text/csv',
      content: `obligation,type,subject,deadline\r\n${obligation.obligationId},${obligation.type},${obligation.reservationId ?? obligation.periodDate},${obligation.deadline.toISOString()}\r\n`,
      instructions: [
        'Open the simulated portal.',
        'Upload this file on its submission page.',
        'Record the confirmation it shows as the receipt.',
      ],
    }
  }

  private answer(filing: Filing): SubmitResult {
    if (filing.asked >= this.acknowledgeAfter) {
      return {
        status: 'acknowledged',
        reference: filing.reference,
        receipt: { reference: filing.reference, acknowledged: true, simulated: true },
      }
    }
    return { status: 'submitted', reference: filing.reference }
  }
}
