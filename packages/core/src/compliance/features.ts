import type { Feature } from '../onboarding/entitlements'

/**
 * The feature each compliance adapter needs (ADR-019), by registry id. Read by
 * surfaces that show obligations without running an adapter, such as the
 * exceptions inbox, so a filing from a module the property does not have is
 * not shown to it. Each adapter's `capabilities().feature` says the same; a
 * test holds the two together.
 */
export const ADAPTER_FEATURES: Readonly<Record<string, Feature>> = {
  alloggiati: 'alloggiati',
  'webtur-fvg': 'istat_regional',
}
