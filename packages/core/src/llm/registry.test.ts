import { afterEach, describe, expect, it } from 'vitest'
import { clearProviders, getProvider, listProviders, registerProvider } from './registry'
import { ResidencyError, type LlmProvider, type ResidencyDeclaration } from './provider'

const NOW = new Date('2026-08-28T00:00:00Z')

function provider(name: string, residency: Partial<ResidencyDeclaration> = {}): LlmProvider {
  return {
    name,
    residency: {
      euProcessing: true,
      region: 'eu-central-1',
      subProcessorRegisterEntry: 'SP-006',
      verifiedAt: '2026-07-01',
      ...residency,
    },
    complete: async () => {
      throw new Error('not used in these tests')
    },
  }
}

afterEach(() => clearProviders())

describe('registration enforces EU residency (D9, ADR-012)', () => {
  it('accepts a provider that declares EU processing with an audit trail', () => {
    registerProvider(provider('anthropic'), NOW)

    expect(getProvider('anthropic').name).toBe('anthropic')
    expect(listProviders()).toHaveLength(1)
  })

  it('refuses a provider that does not process in the EU', () => {
    expect(() => registerProvider(provider('us-only', { euProcessing: false }), NOW)).toThrow(
      ResidencyError,
    )
  })

  it('refuses a provider with no declared region', () => {
    expect(() => registerProvider(provider('vague', { region: '  ' }), NOW)).toThrow(ResidencyError)
  })

  it('refuses a register entry that does not exist', () => {
    /*
     * The gap the non-empty check left open (E8.3).
     *
     * A typo satisfies "is a non-empty string" and produces a provider that
     * looks disclosed and is not. `SP-999` is not in
     * `packages/core/src/privacy/subprocessors.ts`, so it is not in the
     * generated register either, so it is not disclosed to anybody.
     */
    expect(() =>
      registerProvider(provider('typo', { subProcessorRegisterEntry: 'SP-999' }), NOW),
    ).toThrow(/no entry "SP-999"/)
  })

  it('refuses a provider missing its sub-processor register entry', () => {
    // Without the register entry the euProcessing boolean is just a field
    // somebody set to true. The entry is what makes the claim auditable, and
    // D9 requires the register to be updated *before* use.
    expect(() =>
      registerProvider(provider('unregistered', { subProcessorRegisterEntry: '' }), NOW),
    ).toThrow(/sub-processor register/)
  })

  it('refuses a verification that has gone stale', () => {
    expect(() => registerProvider(provider('stale', { verifiedAt: '2024-01-01' }), NOW)).toThrow(
      /re-verify/,
    )
  })

  it('refuses a verification dated in the future', () => {
    expect(() => registerProvider(provider('future', { verifiedAt: '2027-01-01' }), NOW)).toThrow(
      /future/,
    )
  })

  it('refuses an unparseable verification date', () => {
    expect(() => registerProvider(provider('bad', { verifiedAt: 'soon' }), NOW)).toThrow(
      /unparseable/,
    )
  })
})

describe('getProvider', () => {
  it('refuses an unregistered name rather than returning undefined', () => {
    // Returning undefined would make the failure surface somewhere else, as a
    // null deref inside an agent run, long after the residency question was
    // the actual problem.
    expect(() => getProvider('never-registered')).toThrow(ResidencyError)
  })
})
