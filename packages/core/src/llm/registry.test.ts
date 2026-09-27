import { afterEach, describe, expect, it } from 'vitest'
import { clearProviders, getProvider, listProviders, registerProvider } from './registry'
import { ResidencyError, type LlmProvider, type ResidencyDeclaration } from './provider'
import { OPENROUTER_RESIDENCY, openRouterFromEnv, tierFor } from './openrouter'

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

describe('the ADR-029 transfer exception', () => {
  const later = new Date('2026-10-01T00:00:00Z')

  it('accepts non-EU processing only when the provider cites ADR-029', () => {
    registerProvider(
      provider('openrouter', {
        euProcessing: false,
        transferException: 'ADR-029',
        verifiedAt: '2026-09-27',
      }),
      later,
    )

    expect(getProvider('openrouter').residency.euProcessing).toBe(false)
  })

  it('still refuses non-EU processing without the citation', () => {
    expect(() =>
      registerProvider(
        provider('quiet-transfer', { euProcessing: false, verifiedAt: '2026-09-27' }),
        later,
      ),
    ).toThrow(/EU processing is not declared/)
  })

  it('does not waive anything else — the register entry must still exist', () => {
    // The exception is a declared transfer, not a missing check.
    expect(() =>
      registerProvider(
        provider('undisclosed', {
          euProcessing: false,
          transferException: 'ADR-029',
          subProcessorRegisterEntry: 'SP-999',
          verifiedAt: '2026-09-27',
        }),
        later,
      ),
    ).toThrow(/SP-999/)
  })

  it('declares OpenRouter exactly as the register records it', () => {
    registerProvider(provider('openrouter', OPENROUTER_RESIDENCY), later)
    expect(getProvider('openrouter').residency.subProcessorRegisterEntry).toBe('SP-006')
  })
})

describe('OpenRouter configuration', () => {
  it('is absent without a key — the orchestrator then routes deterministically', () => {
    expect(openRouterFromEnv({})).toBeNull()
  })

  it('refuses a key without a model per tier', () => {
    expect(() => openRouterFromEnv({ OPENROUTER_API_KEY: 'k' })).toThrow(/LLM_MODEL_SMALL/)
  })

  it('picks the small tier for classification and the strong tier otherwise', () => {
    expect(tierFor({ task: 'classification' })).toBe('small')
    expect(tierFor({ task: 'conversation' })).toBe('strong')
    expect(tierFor({ task: 'conversation', tier: 'small' })).toBe('small')
  })
})
