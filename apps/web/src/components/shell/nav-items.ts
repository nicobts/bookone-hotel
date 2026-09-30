import type { Feature } from '@bookone/core/onboarding'

/**
 * Which console links a person sees — the decision, without the markup.
 *
 * Pure, so the sidebar's contents for a given role and feature set can be
 * asserted as a list (ADR-019). The sidebar maps each key to a label, a link
 * and an icon; it decides nothing.
 *
 * Presentation only, as the sidebar says about roles: every page behind a
 * gated item calls `requireFeature`, and every owner-only page `requireOwner`.
 */
export type NavKey =
  | 'today'
  | 'exceptions'
  | 'compliance'
  | 'conversations'
  | 'approvals'
  | 'agents'
  | 'reservations'
  | 'guests'
  | 'report'
  | 'assistant'
  | 'setup'
  | 'knowledge'
  | 'rooms'
  | 'members'
  | 'privacy'
  | 'settings'

/**
 * Items that belong to a module. Everything else is the platform itself. A
 * list means any of them: the compliance dashboard shows whichever filing
 * modules the property has (WP1.6).
 */
export const NAV_FEATURE: Partial<Record<NavKey, Feature | readonly Feature[]>> = {
  conversations: 'inbox',
  approvals: 'concierge',
  agents: 'concierge',
  assistant: 'concierge',
  compliance: ['alloggiati', 'istat_regional'],
}

const OPERATE: NavKey[] = [
  'today',
  'exceptions',
  // Filings with the authorities (WP1.6). Staff too: filing by hand is desk work.
  'compliance',
  'conversations',
  'approvals',
  // What the assistants do and a place to try them (ADR-038). In the operating
  // band, for staff too: knowing what the concierge will do is part of running
  // the house.
  'agents',
  'reservations',
  'guests',
]
const OWNER_OPERATE: NavKey[] = ['report', 'assistant']
const CONFIGURE: NavKey[] = ['setup', 'knowledge', 'rooms', 'members', 'privacy', 'settings']

export function navBands(input: { isOwner: boolean; features: ReadonlySet<string> }): {
  operate: NavKey[]
  configure: NavKey[]
} {
  const visible = (key: NavKey) => {
    const feature = NAV_FEATURE[key]
    if (feature === undefined) return true
    return typeof feature === 'string'
      ? input.features.has(feature)
      : feature.some((one) => input.features.has(one))
  }

  return {
    operate: [...OPERATE, ...(input.isOwner ? OWNER_OPERATE : [])].filter(visible),
    configure: input.isOwner ? CONFIGURE.filter(visible) : [],
  }
}
