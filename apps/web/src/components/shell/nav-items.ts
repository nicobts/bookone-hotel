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
  | 'conversations'
  | 'approvals'
  | 'reservations'
  | 'guests'
  | 'report'
  | 'setup'
  | 'knowledge'
  | 'rooms'
  | 'members'
  | 'privacy'
  | 'settings'

/** Items that belong to a module. Everything else is the platform itself. */
export const NAV_FEATURE: Partial<Record<NavKey, Feature>> = {
  conversations: 'inbox',
  approvals: 'concierge',
}

const OPERATE: NavKey[] = [
  'today',
  'exceptions',
  'conversations',
  'approvals',
  'reservations',
  'guests',
]
const OWNER_OPERATE: NavKey[] = ['report']
const CONFIGURE: NavKey[] = ['setup', 'knowledge', 'rooms', 'members', 'privacy', 'settings']

export function navBands(input: { isOwner: boolean; features: ReadonlySet<string> }): {
  operate: NavKey[]
  configure: NavKey[]
} {
  const visible = (key: NavKey) => {
    const feature = NAV_FEATURE[key]
    return feature === undefined || input.features.has(feature)
  }

  return {
    operate: [...OPERATE, ...(input.isOwner ? OWNER_OPERATE : [])].filter(visible),
    configure: input.isOwner ? CONFIGURE.filter(visible) : [],
  }
}
