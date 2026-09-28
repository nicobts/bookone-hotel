import { describe, expect, it } from 'vitest'
import type { ComplianceAdapter, ObligationInput, ObligationType } from '@bookone/core/compliance'
import { FEATURES } from '@bookone/core/onboarding'

/**
 * The shared `ComplianceAdapter` contract (ADR-026, ADR-039, WP1.1).
 *
 * Every authority adapter runs this suite — the WP1.1 fake first, then
 * Alloggiati Web, WebTur FVG and the imposta. Passing it is the precondition
 * for registering an adapter with the lifecycle.
 *
 * What belongs here is what the lifecycle relies on, whatever the authority:
 * complete capabilities, validation that explains itself, a reference for
 * every filing, **submit idempotent on the obligation**, a receipt with every
 * acknowledgement, failures that say whether a retry can help, and a manual
 * fallback a person can use. Deadlines, retries and evidence storage are the
 * lifecycle's, and are tested with it (core, `compliance.test.ts`).
 */
export interface ComplianceContractHooks {
  /** An obligation the adapter should accept and file. A fresh one per call. */
  validObligation: () => ObligationInput | Promise<ObligationInput>
  /** An obligation the adapter must refuse at `validate`. */
  invalidObligation: () => ObligationInput | Promise<ObligationInput>
  /** How many filings actually reached the channel. Proves idempotency. */
  filings: (adapter: ComplianceAdapter) => number
  /** Make the next submit fail, retryable or not. Omit to skip the failure cases. */
  failNext?: (adapter: ComplianceAdapter, retryable: boolean) => void
}

export function describeComplianceAdapterContract(
  name: string,
  createAdapter: () => ComplianceAdapter | Promise<ComplianceAdapter>,
  hooks: ComplianceContractHooks,
): void {
  describe(`ComplianceAdapter contract — ${name}`, () => {
    it('declares every capability ADR-026 lists', async () => {
      const caps = (await createAdapter()).capabilities()

      expect(caps.id).toMatch(/^[a-z0-9-]+$/)
      expect(caps.authority).toBeTruthy()
      expect(FEATURES as readonly string[]).toContain(caps.feature)
      expect(['national', 'region', 'comune']).toContain(caps.jurisdiction.level)
      expect(caps.obligationTypes.length).toBeGreaterThan(0)
      for (const type of caps.obligationTypes) {
        expect([
          'guest_registration',
          'istat_movement',
          'tourist_tax_declaration',
        ] satisfies ObligationType[]).toContain(type)
      }
      expect(['web_service', 'file_upload', 'portal', 'manual']).toContain(caps.transport)
      expect(['receipt', 'protocol_number', 'checksum']).toContain(caps.evidenceType)
      expect(caps.retryPolicy.maxAttempts).toBeGreaterThan(0)
      expect(caps.retryPolicy.backoffSeconds).toBeGreaterThan(0)
      expect(caps.retryPolicy.maxBackoffSeconds).toBeGreaterThanOrEqual(
        caps.retryPolicy.backoffSeconds,
      )
      // Zero would let an automatic attempt start with no time left for a person.
      expect(caps.retryPolicy.manualBeforeDeadlineMinutes).toBeGreaterThan(0)
      expect(caps.manualFallback.contentType).toBeTruthy()
      expect(caps.manualFallback.description).toBeTruthy()
      // Not optional: the worker's production guard reads it.
      expect(typeof caps.simulated).toBe('boolean')
    })

    it('accepts a complete obligation', async () => {
      const adapter = await createAdapter()
      expect(await adapter.validate(await hooks.validObligation())).toEqual({ ok: true })
    })

    it('refuses an incomplete one with issues a person can act on', async () => {
      const adapter = await createAdapter()
      const result = await adapter.validate(await hooks.invalidObligation())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.issues.length).toBeGreaterThan(0)
      for (const issue of result.issues) {
        expect(issue.code).toBeTruthy()
        expect(issue.message.length).toBeGreaterThan(5)
      }
    })

    it('returns a reference for every filing', async () => {
      const adapter = await createAdapter()
      const result = await adapter.submit(await hooks.validObligation())

      expect(['submitted', 'acknowledged']).toContain(result.status)
      if (result.status === 'failed') return
      expect(result.reference).toBeTruthy()
    })

    it('never files the same obligation twice — a second submit only asks', async () => {
      const adapter = await createAdapter()
      const obligation = await hooks.validObligation()

      const first = await adapter.submit(obligation)
      const second = await adapter.submit(obligation)
      const third = await adapter.submit(obligation)

      expect(hooks.filings(adapter)).toBe(1)
      for (const answer of [second, third]) {
        expect(answer.status).not.toBe('failed')
        if (answer.status === 'failed' || first.status === 'failed') continue
        expect(answer.reference).toBe(first.reference)
      }
    })

    it('carries a receipt with every acknowledgement, eventually', async () => {
      const adapter = await createAdapter()
      const obligation = await hooks.validObligation()

      let answer = await adapter.submit(obligation)
      // A queued channel answers later; asking again is how the lifecycle
      // collects it. Twenty asks is far beyond any fake's configured delay.
      for (let asked = 0; answer.status === 'submitted' && asked < 20; asked += 1) {
        answer = await adapter.submit(obligation)
      }

      expect(answer.status).toBe('acknowledged')
      if (answer.status !== 'acknowledged') return
      expect(Object.keys(answer.receipt).length).toBeGreaterThan(0)
    })

    it('says whether a failure can be retried', async () => {
      if (!hooks.failNext) return
      const adapter = await createAdapter()

      hooks.failNext(adapter, true)
      const transient = await adapter.submit(await hooks.validObligation())
      expect(transient).toMatchObject({ status: 'failed', retryable: true })

      hooks.failNext(adapter, false)
      const permanent = await adapter.submit(await hooks.validObligation())
      expect(permanent).toMatchObject({ status: 'failed', retryable: false })
      if (permanent.status === 'failed') {
        expect(permanent.code).toBeTruthy()
        expect(permanent.message).toBeTruthy()
      }
    })

    it('files after a transient failure, once', async () => {
      if (!hooks.failNext) return
      const adapter = await createAdapter()
      const obligation = await hooks.validObligation()

      hooks.failNext(adapter, true)
      expect((await adapter.submit(obligation)).status).toBe('failed')
      expect(['submitted', 'acknowledged']).toContain((await adapter.submit(obligation)).status)
      expect(hooks.filings(adapter)).toBe(1)
    })

    it('always has a manual fallback a person can use', async () => {
      const adapter = await createAdapter()
      const fallback = await adapter.manualFallback(await hooks.validObligation())

      expect(fallback.filename).toBeTruthy()
      expect(fallback.contentType).toBe(adapter.capabilities().manualFallback.contentType)
      expect(fallback.content.length).toBeGreaterThan(0)
      expect(fallback.instructions.length).toBeGreaterThan(0)
      for (const step of fallback.instructions) expect(step.trim().length).toBeGreaterThan(5)
    })
  })
}
