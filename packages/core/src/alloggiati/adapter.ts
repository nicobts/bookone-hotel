/**
 * The Alloggiati channel port (E2.3).
 *
 * ## Why this is a port and not an integration
 *
 * **The channel is an open decision** (04 §0 item 5, PRD §8.3): direct web
 * service against the Questura's own endpoint, or a certified intermediary. It
 * is a legal question as much as a technical one and it is not ours to settle
 * in code.
 *
 * So it gets the treatment the PMS connector got in ADR-008 and payments got in
 * ADR-010: an interface, a mock, a shared contract suite, and everything else
 * built and proven against it. When the decision lands, the answer is a class
 * in `packages/adapters` that passes the same suite — and the payload builder,
 * the validation, the audit trail, the retry, the T-20h alert and the deletion
 * job all stay exactly as they are.
 *
 * ## What the interface deliberately does not assume
 *
 * Not that submission is synchronous. Alloggiati Web returns a receipt on
 * upload; an intermediary may acknowledge later. `submit` therefore returns a
 * *reference* and an optional receipt, and acknowledgement is a separate check
 * — which is also why `alloggiati_state` has both `submitted` and
 * `acknowledged`. Collapsing them would make the deletion job (E2.4) fire on
 * the wrong signal, and that job destroys evidence.
 */

export interface SubmitInput {
  propertyId: string
  reservationId: string
  /** The exact fixed-width text. Built once, stored, and transmitted as-is. */
  payload: string
  guestCount: number
}

export interface SubmitResult {
  /** The channel's own identifier for the filing. Never a key here (ADR-001). */
  reference: string
  /**
   * Present when the channel acknowledges on upload.
   *
   * Absent means "accepted for processing" — which is not the same thing, and
   * is why the deletion job waits for `checkAcknowledgement` rather than
   * treating a successful submit as the end.
   */
  receipt?: Record<string, unknown>
}

export type AcknowledgementResult =
  | { status: 'acknowledged'; receipt: Record<string, unknown> }
  /** Still processing. Neither a success nor a failure; ask again later. */
  | { status: 'pending' }
  | { status: 'failed'; reason: string }

export class AlloggiatiError extends Error {
  constructor(
    readonly code: 'unavailable' | 'rejected' | 'unauthorized' | 'not_found',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AlloggiatiError'
  }
}

export interface AlloggiatiAdapter {
  /** `mock`, `alloggiati-web`, or an intermediary's name. Recorded per row. */
  readonly channel: string

  /**
   * True when nothing is actually filed with an authority.
   *
   * Read by the console so an owner is never shown a compliance obligation as
   * discharged when it was not, and asserted at boot in production. A property
   * that believes its guests are registered when they are not is a property
   * facing a fine, and that is not a failure mode a flag should be able to hide.
   */
  readonly simulated: boolean

  submit(input: SubmitInput): Promise<SubmitResult>

  /** Asks the channel whether a filing has been accepted yet. */
  checkAcknowledgement(input: {
    propertyId: string
    reference: string
  }): Promise<AcknowledgementResult>

  healthCheck(): Promise<{ healthy: boolean; message?: string; checkedAt: Date }>
}
