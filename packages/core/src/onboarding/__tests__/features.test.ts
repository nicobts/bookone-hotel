import { describe, expect, it } from 'vitest'
import { jobNames } from '../../jobs'
import { FEATURES } from '../entitlements'
import { createFeatureCheck, gateOpen, JOB_FEATURE, PHASE0_FEATURES } from '../features'

describe('feature checks (ADR-019)', () => {
  it('reads each property once per check, and only its own rows', async () => {
    const loads: string[] = []
    const check = createFeatureCheck(async (propertyId) => {
      loads.push(propertyId)
      return propertyId === 'p1' ? ['inbox'] : []
    })

    expect(await check('p1', 'inbox')).toBe(true)
    expect(await check('p1', 'concierge')).toBe(false)
    expect(await check('p2', 'inbox')).toBe(false)
    expect(loads).toEqual(['p1', 'p2'])
  })

  it('fails closed: no rows means every feature is off', async () => {
    const check = createFeatureCheck(async () => [])

    for (const feature of FEATURES) {
      expect(await check('p1', feature)).toBe(false)
    }
  })

  it('treats a row for a feature the code does not name as data, not a capability', async () => {
    // The column is free text so a module can be sold before it is built; a row
    // for it must not switch anything on.
    const check = createFeatureCheck(async () => ['something-not-built'])

    for (const feature of FEATURES) {
      expect(await check('p1', feature)).toBe(false)
    }
  })

  it('never consults the store for a core gate', async () => {
    let asked = false
    const check = async () => {
      asked = true
      return false
    }

    expect(await gateOpen(check, 'p1', 'core')).toBe(true)
    expect(asked).toBe(false)
  })
})

describe('the classification', () => {
  it('classifies every job with a known feature or core', () => {
    // Also a compile-time guarantee (a Record over JobName); this catches a
    // value typo that a cast might let through.
    for (const name of jobNames) {
      const gate = JOB_FEATURE[name]
      expect(gate === 'core' || (FEATURES as readonly string[]).includes(gate)).toBe(true)
    }
  })

  it('never gates work that finishes an obligation already in flight', () => {
    // Switching a module off must not strand a paid deposit, a filing awaiting
    // acknowledgement, an identity document awaiting deletion or an erasure.
    for (const name of [
      'payment.replay',
      'alloggiati.check',
      'documents.purge',
      'receipts.purge',
      'privacy.erase',
      'retention.sweep',
      'toolboundary.audit',
    ] as const) {
      expect(JOB_FEATURE[name]).toBe('core')
    }
  })

  it('keeps authority filing out of the Phase 0 set', () => {
    expect(PHASE0_FEATURES).toEqual(['inbox', 'concierge', 'prearrival', 'payments'])
    expect(PHASE0_FEATURES).not.toContain('alloggiati')
  })
})
