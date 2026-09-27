import { describe, expect, it } from 'vitest'
import type { ComplianceAdapter, ObligationInput } from '@bookone/core/compliance'
import { describeComplianceAdapterContract } from '../compliance/contract'
import { MockComplianceAdapter } from './adapter'

let next = 0
function obligation(over: Partial<ObligationInput> = {}): ObligationInput {
  next += 1
  return {
    obligationId: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    propertyId: 'contract-property',
    type: 'guest_registration',
    reservationId: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
    periodDate: null,
    deadline: new Date(Date.now() + 86_400_000),
    attempts: 0,
    ...over,
  }
}

const hooks = {
  validObligation: () => obligation(),
  invalidObligation: () => obligation({ reservationId: null, periodDate: null }),
  filings: (adapter: ComplianceAdapter) => (adapter as MockComplianceAdapter).filings.size,
  failNext: (adapter: ComplianceAdapter, retryable: boolean) =>
    (adapter as MockComplianceAdapter).failNext(retryable),
}

describeComplianceAdapterContract(
  'MockComplianceAdapter (acknowledges on upload)',
  () => new MockComplianceAdapter(),
  hooks,
)

describeComplianceAdapterContract(
  'MockComplianceAdapter (queued channel)',
  () => new MockComplianceAdapter({ acknowledgeAfter: 2 }),
  hooks,
)

describe('MockComplianceAdapter', () => {
  it('answers `submitted` until asked often enough, then acknowledges', async () => {
    const adapter = new MockComplianceAdapter({ acknowledgeAfter: 2 })
    const item = obligation()

    expect((await adapter.submit(item)).status).toBe('submitted')
    expect((await adapter.submit(item)).status).toBe('submitted')
    expect((await adapter.submit(item)).status).toBe('acknowledged')
    expect(adapter.filings.size).toBe(1)
  })

  it('counts injected failures', async () => {
    const adapter = new MockComplianceAdapter()
    adapter.failNext(true, 2)

    expect((await adapter.submit(obligation())).status).toBe('failed')
    expect((await adapter.submit(obligation())).status).toBe('failed')
    expect((await adapter.submit(obligation())).status).toBe('acknowledged')
  })
})
