import { describe, expect, it } from 'vitest'
import { FEATURES, PHASE0_FEATURES } from '@bookone/core/onboarding'
import { navBands } from './nav-items'

/**
 * The console sidebar for a given role and feature set (ADR-019).
 *
 * Presentation, not permission — `requireFeature` is the control — but the
 * list is asserted exactly, so a module that leaks into the nav of a property
 * without it fails here rather than in a demo.
 */
describe('navBands', () => {
  it('with no features, shows an owner only the platform itself', () => {
    expect(navBands({ isOwner: true, features: new Set() })).toEqual({
      operate: ['today', 'exceptions', 'reservations', 'guests', 'report'],
      configure: ['setup', 'knowledge', 'rooms', 'members', 'privacy', 'settings'],
    })
  })

  it('with the Phase 0 set, adds conversations', () => {
    expect(navBands({ isOwner: true, features: new Set(PHASE0_FEATURES) }).operate).toEqual([
      'today',
      'exceptions',
      'conversations',
      'approvals',
      'agents',
      'reservations',
      'guests',
      'report',
      'assistant',
    ])
  })

  it('shows the filings with either filing module, and not without one (WP1.6)', () => {
    for (const feature of ['alloggiati', 'istat_regional']) {
      expect(navBands({ isOwner: false, features: new Set([feature]) }).operate).toContain(
        'compliance',
      )
    }
    expect(navBands({ isOwner: true, features: new Set(PHASE0_FEATURES) }).operate).not.toContain(
      'compliance',
    )
  })

  it('gives staff the operating band only, whatever the property has', () => {
    expect(navBands({ isOwner: false, features: new Set(FEATURES) })).toEqual({
      operate: [
        'today',
        'exceptions',
        'compliance',
        'conversations',
        'approvals',
        'agents',
        'reservations',
        'guests',
      ],
      configure: [],
    })
  })
})
