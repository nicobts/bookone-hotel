/**
 * The ComplianceAdapter port (ADR-026, ADR-039, Guest Desk WP1.1).
 *
 * Every authority a property files with — the Questura through Alloggiati Web,
 * the Regione's ISTAT portal, the comune's imposta office — is one adapter
 * with exactly these four methods. The lifecycle (`lifecycle.ts`,
 * `obligations.ts`) owns deadlines, retries, state and evidence; an adapter
 * only knows its authority.
 *
 * Two rules every implementation keeps, and the contract suite
 * (`contract.ts`) checks:
 *
 * - **Submit is idempotent on the obligation.** A second `submit` for an
 *   obligation the channel already has must not file again. It returns what
 *   the channel says now: still `submitted`, or `acknowledged` with the
 *   receipt. This is how a queued channel's acknowledgement is collected
 *   without a fifth method (ADR-039).
 * - **There is always a manual fallback.** `manualFallback` returns what a
 *   person needs to file by hand in under two minutes: the exact file or data
 *   the authority's portal accepts, and the steps.
 */
import type { Feature } from '../onboarding/entitlements'

export type ObligationType = 'guest_registration' | 'istat_movement' | 'tourist_tax_declaration'

/** Whom it is owed to. A code, never a name the code branches on (ADR-028). */
export type Jurisdiction =
  | { level: 'national'; country: string }
  | { level: 'region'; code: string }
  | { level: 'comune'; code: string }

export interface ComplianceCapabilities {
  /** Registry id: what `compliance_obligations.adapter_id` holds. */
  id: string
  /** The authority as the registry names it (`questura`). */
  authority: string
  /** The entitlement that must be live for this adapter to run (ADR-019). */
  feature: Feature
  jurisdiction: Jurisdiction
  obligationTypes: ObligationType[]
  /** How a filing travels. `manual` is an adapter whose only route is the fallback. */
  transport: 'web_service' | 'file_upload' | 'portal' | 'manual'
  /** What proves a filing: the authority's receipt, a protocol number, a checksum. */
  evidenceType: 'receipt' | 'protocol_number' | 'checksum'
  retryPolicy: {
    /** Attempts before the obligation goes to a person. */
    maxAttempts: number
    /** Wait before the second attempt; doubled for each after, capped at `maxBackoffSeconds`. */
    backoffSeconds: number
    maxBackoffSeconds: number
    /**
     * How close to the deadline an automatic attempt may still start. Inside
     * this margin the obligation goes to a person: a filing that might fail
     * with ten minutes left is one nobody can rescue.
     */
    manualBeforeDeadlineMinutes: number
  }
  manualFallback: {
    /** The media type of the file the fallback produces. */
    contentType: string
    /** What the fallback is, in a sentence, for the console. */
    description: string
  }
  /** True for mocks and fakes. The worker refuses to boot simulated in production. */
  simulated: boolean
}

/** One obligation, as the lifecycle hands it to an adapter. */
export interface ObligationInput {
  obligationId: string
  propertyId: string
  type: ObligationType
  /** The stay, for per-stay obligations. */
  reservationId: string | null
  /** The day, for per-day obligations (`YYYY-MM-DD`). */
  periodDate: string | null
  deadline: Date
  /** Attempts already made, not counting this one. */
  attempts: number
}

/** A problem a person can fix, in their words, with the field when there is one. */
export interface ComplianceIssue {
  code: string
  message: string
  field?: string
}

export type ValidationResult = { ok: true } | { ok: false; issues: ComplianceIssue[] }

export type SubmitResult =
  /**
   * Filed and answered: the receipt is the evidence, kept for as long as the
   * property is a client. **It never carries a guest's details** — references,
   * counts, dates and checksums only; an authority whose receipt names people
   * has them removed by the adapter before it returns (data map,
   * `compliance_evidence`).
   */
  | { status: 'acknowledged'; reference: string; receipt: Record<string, unknown> }
  /** Filed, the authority has not answered yet. Submit again later to ask. */
  | { status: 'submitted'; reference: string }
  /**
   * Not filed. `retryable` says whether trying again can help: a timeout can,
   * a rejected field cannot.
   */
  | { status: 'failed'; code: string; message: string; retryable: boolean }

export interface ManualFallback {
  filename: string
  contentType: string
  /** The file exactly as the authority's portal accepts it. */
  content: string
  /** The steps, in order, each a sentence a receptionist can follow. */
  instructions: string[]
}

export interface ComplianceAdapter {
  capabilities(): ComplianceCapabilities
  validate(obligation: ObligationInput): Promise<ValidationResult>
  submit(obligation: ObligationInput): Promise<SubmitResult>
  manualFallback(obligation: ObligationInput): Promise<ManualFallback>
}
